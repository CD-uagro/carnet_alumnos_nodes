const {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} = require('@azure/storage-blob');

const DEFAULT_CONTAINER = 'fotos-carnet';

function isPhotoStorageConfigured() {
  return Boolean(
    process.env.AZURE_STORAGE_CONNECTION_STRING &&
      (process.env.AZURE_STORAGE_CONTAINER_FOTOS ||
        process.env.AZURE_STORAGE_CONTAINER_PHOTOS ||
        DEFAULT_CONTAINER)
  );
}

function getContainerName() {
  return (
    process.env.AZURE_STORAGE_CONTAINER_FOTOS ||
    process.env.AZURE_STORAGE_CONTAINER_PHOTOS ||
    DEFAULT_CONTAINER
  );
}

function getContainerClient() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    const error = new Error(
      'Azure Blob Storage no está configurado para fotografías.'
    );
    error.code = 'PHOTO_STORAGE_NOT_CONFIGURED';
    throw error;
  }

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  return blobServiceClient.getContainerClient(getContainerName());
}

function parseConnectionString() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) return null;

  const parts = {};
  for (const part of connectionString.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = part.slice(0, separatorIndex);
    const value = part.slice(separatorIndex + 1);
    if (key && value) parts[key] = value;
  }

  if (!parts.AccountName || !parts.AccountKey) return null;

  return {
    accountName: parts.AccountName,
    accountKey: parts.AccountKey
  };
}

function extensionFromMime(mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

function safeMatricula(matricula) {
  return String(matricula).replace(/[^a-zA-Z0-9_-]/g, '');
}

async function uploadCarnetPhotoToStorage({ matricula, buffer, mimeType }) {
  const containerClient = getContainerClient();
  await containerClient.createIfNotExists();

  const extension = extensionFromMime(mimeType);
  const blobName = `${safeMatricula(matricula)}.${extension}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: mimeType,
      blobCacheControl: 'private, max-age=300',
    },
    metadata: {
      matricula: safeMatricula(matricula),
      origen: 'carnet-digital-uagro',
    },
  });

  return blockBlobClient.url;
}

function blobNameFromUrl(fotoUrl) {
  if (!fotoUrl) return null;

  const url = new URL(fotoUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  const blobName = decodeURIComponent(parts.slice(1).join('/'));
  return blobName || null;
}

function getCarnetPhotoReadUrl(fotoUrl) {
  if (!fotoUrl || !isPhotoStorageConfigured()) return fotoUrl;

  const parsed = parseConnectionString();
  if (!parsed) return fotoUrl;

  try {
    const blobName = blobNameFromUrl(fotoUrl);
    if (!blobName) return fotoUrl;

    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + 60 * 60 * 1000);
    const credential = new StorageSharedKeyCredential(
      parsed.accountName,
      parsed.accountKey
    );
    const sas = generateBlobSASQueryParameters(
      {
        containerName: getContainerName(),
        blobName,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn
      },
      credential
    ).toString();

    return `${fotoUrl.split('?')[0]}?${sas}&v=${Date.now()}`;
  } catch (error) {
    console.warn('No se pudo generar SAS temporal para fotografia:', error.message);
    return fotoUrl;
  }
}

async function deleteCarnetPhotoFromStorage(fotoUrl) {
  if (!fotoUrl || !isPhotoStorageConfigured()) return;

  try {
    const containerClient = getContainerClient();
    const blobName = blobNameFromUrl(fotoUrl);
    if (!blobName) return;

    await containerClient.getBlockBlobClient(blobName).deleteIfExists();
  } catch (error) {
    console.warn('⚠️ No se pudo eliminar la fotografía anterior:', error.message);
  }
}

module.exports = {
  isPhotoStorageConfigured,
  uploadCarnetPhotoToStorage,
  getCarnetPhotoReadUrl,
  deleteCarnetPhotoFromStorage,
};
