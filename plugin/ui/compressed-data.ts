export async function unpackData<T>(bytes: Uint8Array): Promise<T> {
	return new Response(new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream("gzip"))).json() as Promise<T>;
}
