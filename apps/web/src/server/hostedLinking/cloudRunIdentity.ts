import { EffectString } from "@lineupkeep/collections";
const metadataIdentityUrl =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

export async function cloudRunIdentityToken(audience: string): Promise<string> {
  const url = new URL(metadataIdentityUrl);
  url.searchParams.set("audience", audience);
  url.searchParams.set("format", "full");
  const response = await fetch(url, { headers: { "metadata-flavor": "Google" } });
  if (!response.ok) {
    throw new Error(`The Cloud Run identity token request failed with ${response.status}`);
  }
  const token = EffectString.trim(await response.text());
  if (token === "") {
    throw new Error("The Cloud Run identity token response was empty");
  }
  return token;
}
