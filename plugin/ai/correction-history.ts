import { StateEffect, Transaction, type TransactionSpec, type Text } from "@codemirror/state";
import { history, invertedEffects, isolateHistory } from "@codemirror/commands";
import type { AIGroup, AIGroupHost } from "./ai-extension";

const epochs = new WeakMap<AIGroupHost, object>();
const epoch = (host: AIGroupHost): object => {
	let value = epochs.get(host);
	if (!value) epochs.set(host, value = {});
	return value;
};

export function resetCorrectionHistory(host: AIGroupHost): void {
	epochs.set(host, {});
}

const resolution = StateEffect.define<{ host: AIGroupHost; epoch: object; group: AIGroup; from: number; restore: boolean }>({
	map: (value, changes) => ({ ...value, from: changes.mapPos(value.from, -1) }),
});

export const correctionHistory = [
	history({ minDepth: 10 }),
	invertedEffects.of(transaction => transaction.effects.flatMap(effect => effect.is(resolution)
		? [resolution.of({ ...effect.value, restore: !effect.value.restore })] : [])),
];

export function resolveCorrection(host: AIGroupHost, group: AIGroup, accept: boolean): TransactionSpec {
	return {
		changes: accept ? { from: group.delFrom, to: group.delTo, insert: group.insText ?? "" } : undefined,
		effects: resolution.of({ host, epoch: epoch(host), group: { ...group }, from: group.delFrom, restore: false }),
		annotations: [isolateHistory.of("full"), Transaction.userEvent.of("input.finition-correction")],
	};
}

export function applyCorrectionHistory(host: AIGroupHost, transactions: readonly Transaction[], document: Text): void {
	for (const transaction of transactions) for (const effect of transaction.effects) {
		if (!effect.is(resolution)) continue;
		const value = effect.value;
		if (value.host !== host || value.epoch !== epoch(host)) continue;
		const group = { ...value.group, delFrom: value.from, delTo: value.from + value.group.delText.length };
		if (value.restore && (group.delFrom < 0 || group.delTo > document.length || document.sliceString(group.delFrom, group.delTo) !== group.delText)) continue;
		host.aiGroups = host.aiGroups.filter(item => item.id !== group.id);
		if (value.restore) host.aiGroups.push(group);
		host.aiGroups.sort((a, b) => a.delFrom - b.delFrom || a.delTo - b.delTo);
		host.aiGroupsVersion++;
	}
}
