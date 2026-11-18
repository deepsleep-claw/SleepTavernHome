export function readImportFile(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法读取文件中的文本内容。'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败。'));
    reader.onabort = () => reject(new Error('文件读取已取消。'));
    reader.readAsText(file, 'UTF-8');
  });
}
