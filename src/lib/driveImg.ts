// Converte URL do Google Drive para o proxy local
// Input:  https://drive.google.com/uc?export=view&id=XXXX
//         https://drive.google.com/file/d/XXXX/view
// Output: /api/img?id=XXXX
export function driveImg(url: string | undefined): string {
  if (!url) return '';

  // Formato uc?export=view&id=XXXX
  const uc = url.match(/[?&]id=([^&]+)/);
  if (uc) return `/api/img?id=${uc[1]}`;

  // Formato /file/d/XXXX/
  const fd = url.match(/\/file\/d\/([^/]+)/);
  if (fd) return `/api/img?id=${fd[1]}`;

  // Não é Drive — devolve a URL original
  return url;
}
