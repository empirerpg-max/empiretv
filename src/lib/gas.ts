export const GAS_URL =
  'https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec';

export function fetchGAS(_params: Record<string, string> = {}): Promise<any> {
  return fetch('/api/gas')
    .then(r => r.json())
    .catch(() => ({}));
}
