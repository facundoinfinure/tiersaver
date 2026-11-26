import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  return null;
};

/** Shown only when the address is opened outside Shopify. The app never asks for a shop domain. */
export default function Outside() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>TierSaver</h1>
        <p className={styles.text}>
          TierSaver runs inside your Shopify admin. To open it, go to Apps in your Shopify admin and choose TierSaver.
        </p>
      </div>
    </div>
  );
}
