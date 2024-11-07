import { PublicKey } from "@drift-labs/sdk";
import { FUNDS_PROGRAM_ID } from "./config.js";
export function bnToDecimal(bn, decimalPlaces) {
    const decimalFactor = Math.pow(10, decimalPlaces);
    return bn.toNumber() / decimalFactor;
}
export const getVault = (owner) => {
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.toBuffer()], new PublicKey(FUNDS_PROGRAM_ID));
    return vault;
};
