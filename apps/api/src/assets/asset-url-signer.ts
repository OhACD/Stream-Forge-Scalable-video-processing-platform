import { createHmac } from "node:crypto";
import { Storage } from "@google-cloud/storage";

export type SignObjectPathInput = {
  objectPath: string;
  expiresInSeconds?: number;
};

export interface AssetUrlSigner {
  signObjectPath(input: SignObjectPathInput): Promise<string>;
}

export class HmacAssetUrlSigner implements AssetUrlSigner {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly defaultExpiresInSeconds: number
  ) {}

  async signObjectPath(input: SignObjectPathInput): Promise<string> {
    const expiresInSeconds = input.expiresInSeconds ?? this.defaultExpiresInSeconds;
    const expiresAtEpoch = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = `${input.objectPath}:${expiresAtEpoch}`;
    const signature = createHmac("sha256", this.secret).update(payload).digest("hex");

    const query = new URLSearchParams({
      path: input.objectPath,
      exp: String(expiresAtEpoch),
      sig: signature
    }).toString();

    if (this.baseUrl.startsWith("/")) {
      const separator = this.baseUrl.includes("?") ? "&" : "?";
      return `${this.baseUrl}${separator}${query}`;
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set("path", input.objectPath);
    url.searchParams.set("exp", String(expiresAtEpoch));
    url.searchParams.set("sig", signature);
    return url.toString();
  }
}

export class GoogleCloudStorageAssetUrlSigner implements AssetUrlSigner {
  private readonly storage = new Storage();

  constructor(private readonly bucketName: string) {}

  async signObjectPath(input: SignObjectPathInput): Promise<string> {
    const expiresInSeconds = input.expiresInSeconds ?? 300;
    const expiresAt = Date.now() + expiresInSeconds * 1000;

    const [url] = await this.storage.bucket(this.bucketName).file(input.objectPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresAt
    });

    return url;
  }
}
