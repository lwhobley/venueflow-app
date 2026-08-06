import * as FileSystem from 'expo-file-system/legacy';

export type PickedFileAsset = {
  uri: string;
  file?: Blob | null;
};

export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).includes(';base64')) {
    throw new Error('The selected file could not be encoded.');
  }
  return dataUrl.slice(comma + 1);
}

export async function readPickedFileText(asset: PickedFileAsset): Promise<string> {
  if (asset.file && typeof asset.file.text === 'function') {
    return asset.file.text();
  }
  return FileSystem.readAsStringAsync(asset.uri);
}

export async function readPickedFileBase64(asset: PickedFileAsset): Promise<string> {
  if (asset.file) {
    if (typeof FileReader === 'undefined') {
      throw new Error('This browser cannot read the selected file.');
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('The selected file could not be read.'));
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('The selected file could not be read.'));
      reader.readAsDataURL(asset.file!);
    });
    return base64FromDataUrl(dataUrl);
  }
  return FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
}
