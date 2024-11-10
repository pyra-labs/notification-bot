import { BN, PublicKey } from "@drift-labs/sdk";
import { FUNDS_PROGRAM_ID } from "./config.js";

export function bnToDecimal(bn: BN, decimalPlaces: number): number {
    const decimalFactor = Math.pow(10, decimalPlaces);
    return bn.toNumber() / decimalFactor;
}

export const getVault = (owner: PublicKey) => {
    const [vault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.toBuffer()],
        new PublicKey(FUNDS_PROGRAM_ID)
    )
    return vault;
}

export function getDisplayWalletAddress(address: string) {
    return `(${address.slice(0, 4)}...${address.slice(-4)})` 
}
