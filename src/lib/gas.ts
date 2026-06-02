export const GAS_URL =
  "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3b7sK8DD59BHRBRc5Ow1YB/exec";

export function fetchGAS(params: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve) => {
    const cbName = "__gas_cb_" + Date.now().toString(36);
    const query = new URLSearchParams({ ...params, callback: cbName }).toString();
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      resolve({});
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete (window as any)[cbName];
      script.remove();
    }

    (window as any)[cbName] = (data: any) => {
      cleanup();
      resolve(data);
    };

    script.src = `${GAS_URL}?${query}`;
    script.onerror = () => { cleanup(); resolve({}); };
    document.head.appendChild(script);
  });
}
