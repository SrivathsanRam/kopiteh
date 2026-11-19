import crypto from "crypto";
import path from "path";
import { publicImageBucket } from "../config/firebase";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function publicDownloadUrl(bucketName: string, key: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(key)}?alt=media&token=${token}`;
}

async function savePublicImage(buffer: Buffer, contentType: string, extension: string, folder: string) {
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error("Unsupported image type");
  }
  const normalizedFolder = folder
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9/_-]/g, "-") || "uploads";
  const key = `public/${normalizedFolder}/${crypto.randomUUID()}${extension}`;
  const downloadToken = crypto.randomUUID();
  await publicImageBucket.file(key).save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });
  return publicDownloadUrl(publicImageBucket.name, key, downloadToken);
}

export class UploadService {
  async uploadImage(file: Express.Multer.File, folder = "uploads") {
    return savePublicImage(
      file.buffer,
      file.mimetype,
      path.extname(file.originalname) || ".jpg",
      folder,
    );
  }

  async uploadMultipleImages(files: Express.Multer.File[], folder = "uploads") {
    return Promise.all(files.map((file) => this.uploadImage(file, folder)));
  }

  async uploadBase64Image(dataUri: string, folder = "uploads") {
    const matches = dataUri.match(/^data:(.+);base64,(.+)$/);
    if (!matches) throw new Error("Invalid data URI format");
    const contentType = matches[1];
    const extension = `.${contentType.split("/")[1].replace("jpeg", "jpg")}`;
    return savePublicImage(Buffer.from(matches[2], "base64"), contentType, extension, folder);
  }
}

export default new UploadService();
