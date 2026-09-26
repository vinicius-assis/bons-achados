// "web" (default) reads the storefront deals feed with the session cookie;
// "creators" uses the official Creators API. Flip back to "creators" once its
// credentials work — nothing else needs to change.
export function getAmazonSource(): "web" | "creators" {
  return process.env.AMAZON_SOURCE === "creators" ? "creators" : "web";
}
