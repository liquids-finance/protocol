import { redirect } from "next/navigation";

/**
 * Root route → markets. Markets is the first thing a new visitor should see;
 * dashboard only makes sense once a wallet is connected and has positions.
 */
export default function RootPage() {
  redirect("/markets");
}
