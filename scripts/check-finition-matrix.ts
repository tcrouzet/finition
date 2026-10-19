import { strict as assert } from "node:assert";
import * as process from "node:process";
import { createMatrixKernel } from "../plugin/modes/finition-corrector/matrix";

const memory = new WebAssembly.Memory({ initial: 1 }), kernel = createMatrixKernel(memory);
const floats = new Float32Array(memory.buffer), unsigned = new Uint8Array(memory.buffer), signed = new Int8Array(memory.buffer);
for (const length of [0, 1, 3, 4, 15, 16, 17, 31, 64, 769]) {
	let expected = 0;
	for (let i = 0; i < length; i++) { floats[i] = ((i * 13) % 31 - 15) / 4; floats[1024 + i] = ((i * 29) % 37 - 18) / 4; expected += floats[i] * floats[1024 + i]; }
	assert.equal(kernel.floatDot(0, 4096, length), expected, `Produit flottant, longueur ${length}`);
	expected = 0;
	for (let i = 0; i < length; i++) { unsigned[i] = (i * 67 + 113) % 256; signed[4096 + i] = (i * 23 + 99) % 256 - 128; expected += unsigned[i] * signed[4096 + i]; }
	assert.equal(kernel.integerDot(0, 4096, length), expected, `Produit quantifié, longueur ${length}`);
}
const rows = 3, columns = 5, inner = 17;
floats.fill(0);
for (let i = 0; i < rows * inner; i++) floats[i] = (i % 19 - 9) / 4;
for (let i = 0; i < columns * inner; i++) floats[1024 + i] = (i % 23 - 11) / 4;
floats.set([1, -2, 3, -4, 5], 2048);
kernel.floatMatrix(0, 4096, 12288, rows, columns, inner, 8192);
for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
	let sum = floats[2048 + column];
	for (let i = 0; i < inner; i++) sum += floats[row * inner + i] * floats[1024 + column * inner + i];
	assert.equal(floats[3072 + row * columns + column], sum, "Projection flottante avec biais");
}
for (let i = 0; i < rows * inner; i++) unsigned[i] = (i * 17 + 53) % 256;
for (let i = 0; i < columns * inner; i++) signed[4096 + i] = (i * 31 + 71) % 256 - 128;
const sums = new Int32Array(memory.buffer, 16384, columns);
floats.set([0.125, 0.25, 0.5, 1, 2], 5120);
for (let column = 0; column < columns; column++) for (let i = 0; i < inner; i++) sums[column] += signed[4096 + column * inner + i];
kernel.integerMatrix(0, 4096, 12288, rows, columns, inner, 8192, 16384, 20480, 127, 0.125);
for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
	let sum = 0;
	for (let i = 0; i < inner; i++) sum += (unsigned[row * inner + i] - 127) * signed[4096 + column * inner + i];
	assert.equal(floats[3072 + row * columns + column], Math.fround(Math.fround(sum * Math.fround(0.125 * floats[5120 + column])) + floats[2048 + column]), "Projection quantifiée avec décalage, échelle et biais");
}
process.stdout.write("PASS: produits et matrices SIMD, flottants et quantifiés, biais, échelles, décalages et restes de vecteurs\n");
