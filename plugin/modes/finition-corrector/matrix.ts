const uleb = (value: number): number[] => value < 128 ? [value] : [(value & 127) | 128, ...uleb(value >>> 7)];
const section = (id: number, bytes: number[]): number[] => [id, ...uleb(bytes.length), ...bytes];
const name = (text: string): number[] => [...uleb(text.length), ...new TextEncoder().encode(text)];
const get = (index: number): number[] => [0x20, index];
const set = (index: number): number[] => [0x21, index];
const simd = (opcode: number): number[] => [0xfd, ...uleb(opcode)];
const constant = (value: number): number[] => [0x41, value];
const add = 0x6a, multiply = 0x6c;
const address = (pointer: number, index: number, stride = 1): number[] => [...get(pointer), ...get(index), ...(stride === 1 ? [] : [...constant(stride), multiply]), add];
const loop = (index: number, limit: number, body: number[], step = 1): number[] => [
	...constant(0), ...set(index), 0x02, 0x40, 0x03, 0x40,
	...get(index), ...get(limit), 0x4f, 0x0d, 1, ...body,
	...get(index), ...constant(step), add, ...set(index), 0x0c, 0, 0x0b, 0x0b,
];

// Produits scalaires SIMD construits par ce code ; aucun binaire ni runtime externe.
function dot(integer: boolean): number[] {
	const step = integer ? 16 : 4, size = integer ? 1 : 4;
	const load = (pointer: number): number[] => [...address(pointer, 3, size), ...simd(0), 0, 0];
	const extract = (lane: number): number[] => [...get(4), ...simd(integer ? 0x1b : 0x1f), lane];
	const vector = integer ? [
		...load(0), ...set(5), ...load(1), ...set(6),
		...get(4), ...get(5), ...simd(0x89), ...get(6), ...simd(0x87), ...simd(0xba), ...simd(0xae),
		...get(5), ...simd(0x8a), ...get(6), ...simd(0x88), ...simd(0xba), ...simd(0xae), ...set(4),
	] : [...get(4), ...load(0), ...load(1), ...simd(0xe6), ...simd(0xe4), ...set(4)];
	return [
		3, 1, 0x7f, 3, 0x7b, 1, integer ? 0x7f : 0x7d,
		...simd(0x0c), ...Array<number>(16).fill(0), ...set(4),
		0x02, 0x40, 0x03, 0x40,
		...get(3), ...constant(step), add, ...get(2), 0x4b, 0x0d, 1,
		...vector, ...get(3), ...constant(step), add, ...set(3), 0x0c, 0, 0x0b, 0x0b,
		...extract(0), ...extract(1), integer ? add : 0x92,
		...extract(2), integer ? add : 0x92, ...extract(3), integer ? add : 0x92, ...set(7),
		0x02, 0x40, 0x03, 0x40,
		...get(3), ...get(2), 0x4f, 0x0d, 1,
		...get(7), ...address(0, 3, size), integer ? 0x2d : 0x2a, integer ? 0 : 2, 0,
		...address(1, 3, size), integer ? 0x2c : 0x2a, integer ? 0 : 2, 0,
		integer ? multiply : 0x94, integer ? add : 0x92, ...set(7),
		...get(3), ...constant(1), add, ...set(3), 0x0c, 0, 0x0b, 0x0b, ...get(7), 0x0b,
	];
}

function floatMatrix(mixed: boolean): number[] {
	const local = mixed ? 9 : 7, row = local, column = local + 1, index = local + 2, limit = local + 3;
	const first = local + 4, weight = local + 8;
	const input = (lane: number) => [...get(0), ...get(row), ...constant(lane), add, ...get(5), multiply, ...constant(4), multiply, add];
	const source = mixed ? get(8) : [...get(1), ...get(column), ...get(5), multiply, ...constant(4), multiply, add];
	const output = (lane: number) => [...get(2), ...get(row), ...constant(lane), add, ...get(4), multiply, ...get(column), add, ...constant(4), multiply, add];
	const vector: number[] = [...source, ...get(index), ...constant(4), multiply, add, ...simd(0), 0, 0, ...set(weight)];
	const store: number[] = [], zero: number[] = [];
	for (let lane = 0; lane < 4; lane++) {
		const accumulator = first + lane;
		zero.push(...simd(0x0c), ...Array<number>(16).fill(0), ...set(accumulator));
		vector.push(...get(accumulator), ...input(lane), ...get(index), ...constant(4), multiply, add, ...simd(0), 0, 0, ...get(weight), ...simd(0xe6), ...simd(0xe4), ...set(accumulator));
		store.push(...output(lane), ...get(accumulator), ...simd(0x1f), 0);
		for (let part = 1; part < 4; part++) store.push(...get(accumulator), ...simd(0x1f), part, 0x92);
		store.push(...address(6, column, 4), 0x2a, 2, 0, 0x92, 0x38, 2, 0);
	}
	const convert = mixed ? loop(index, 5, [
		...address(8, index, 4), ...get(1), ...get(column), ...get(5), multiply, add, ...get(index), add, 0x2c, 0, 0, 0xb2,
		...address(7, column, 4), 0x2a, 2, 0, 0x94, 0x38, 2, 0,
	]) : [];
	const tail = [
		0x02, 0x40, 0x03, 0x40, ...get(row), ...get(3), 0x4f, 0x0d, 1,
		...output(0), ...input(0), ...source, ...get(5), 0x10, 0, ...address(6, column, 4), 0x2a, 2, 0, 0x92, 0x38, 2, 0,
		...get(row), ...constant(1), add, ...set(row), 0x0c, 0, 0x0b, 0x0b,
	];
	return [2, 4, 0x7f, 5, 0x7b,
		...get(3), ...constant(4), 0x6e, ...constant(4), multiply, ...set(limit),
		...loop(column, 4, [
			...convert, ...constant(0), ...set(row), ...get(5), ...constant(4), 0x70, 0x45, 0x04, 0x40,
			...loop(row, limit, [...zero, ...loop(index, 5, vector, 4), ...store], 4), 0x0b, ...tail,
		]), 0x0b];
}

function matrix(integer: boolean, mixed = false): number[] {
	if (!integer) return floatMatrix(mixed);
	const row = 11, column = 12;
	const pointer = (base: number, index: number): number[] => [...get(base), ...get(index), ...get(5), multiply, add];
	return [1, 2, 0x7f, ...loop(row, 3, loop(column, 4, [
		...get(2), ...get(row), ...get(4), multiply, ...get(column), add, ...constant(4), multiply, add,
		...pointer(0, row), ...pointer(1, column), ...get(5), 0x10, 1,
		...get(9), ...address(7, column, 4), 0x28, 2, 0, multiply, 0x6b, 0xb2,
		...get(10), ...address(8, column, 4), 0x2a, 2, 0, 0x94, 0x94,
		...address(6, column, 4), 0x2a, 2, 0, 0x92, 0x38, 2, 0,
	])), 0x0b];
}

const type = (parameters: number[], results: number[]): number[] => [0x60, ...uleb(parameters.length), ...parameters, ...uleb(results.length), ...results];
const functions = [dot(false), dot(true), matrix(false), matrix(true), matrix(false, true)];
const moduleBytes = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0,
	...section(1, [5, ...type([0x7f, 0x7f, 0x7f], [0x7d]), ...type([0x7f, 0x7f, 0x7f], [0x7f]), ...type(Array<number>(7).fill(0x7f), []), ...type([...Array<number>(10).fill(0x7f), 0x7d], []), ...type(Array<number>(9).fill(0x7f), [])]),
	...section(2, [1, ...name("env"), ...name("memory"), 2, 0, 1]),
	...section(3, [5, 0, 1, 2, 3, 4]),
	...section(7, [5, ...name("floatDot"), 0, 0, ...name("integerDot"), 0, 1, ...name("floatMatrix"), 0, 2, ...name("integerMatrix"), 0, 3, ...name("mixedMatrix"), 0, 4]),
	...section(10, [5, ...functions.flatMap(bytes => [...uleb(bytes.length), ...bytes])]),
]);
let compiled: WebAssembly.Module | undefined;

export interface MatrixKernel {
	floatDot(a: number, b: number, length: number): number;
	integerDot(a: number, b: number, length: number): number;
	floatMatrix(a: number, b: number, output: number, rows: number, columns: number, inner: number, bias: number): void;
	integerMatrix(a: number, b: number, output: number, rows: number, columns: number, inner: number, bias: number, sums: number, scales: number, zero: number, scale: number): void;
	mixedMatrix(a: number, b: number, output: number, rows: number, columns: number, inner: number, bias: number, scales: number, workspace: number): void;
}

export function createMatrixKernel(memory: WebAssembly.Memory): MatrixKernel {
	compiled ??= new WebAssembly.Module(moduleBytes);
	return new WebAssembly.Instance(compiled, { env: { memory } }).exports as unknown as MatrixKernel;
}
