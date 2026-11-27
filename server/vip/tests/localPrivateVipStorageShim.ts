/**
 * Test-only adapter. Only receipt bytes use the temporary filesystem shim;
 * other private-object features intentionally fail closed if accidentally hit.
 */
export {
  savePrivateReceipt,
  readPrivateReceipt,
  removePrivateReceipt,
} from "./privateFileStorageShim";

export async function savePrivateProjectPhoto(): Promise<never> {
  throw new Error("Project photo storage is not enabled in this integration test");
}
export async function readPrivateProjectPhoto(): Promise<never> {
  throw new Error("Project photo storage is not enabled in this integration test");
}
export async function removePrivateProjectPhoto(): Promise<never> {
  throw new Error("Project photo storage is not enabled in this integration test");
}
export async function savePrivateOfficialStatement(): Promise<never> {
  throw new Error("Official statement storage is not enabled in this integration test");
}
export async function readPrivateOfficialStatement(): Promise<never> {
  throw new Error("Official statement storage is not enabled in this integration test");
}
export async function removePrivateOfficialStatement(): Promise<never> {
  throw new Error("Official statement storage is not enabled in this integration test");
}
