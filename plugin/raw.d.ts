declare module "*?raw" {
	const content: string;
	export default content;
}

declare module "*?gzip" {
	const content: Uint8Array;
	export default content;
}

declare module "*?worker" {
	const content: string;
	export default content;
}
declare module "onnxruntime-web/webgpu" {
	export * from "onnxruntime-web";
}
