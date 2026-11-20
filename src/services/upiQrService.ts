import QRCode from 'qrcode';

export interface ShopUpiConfig {
  vpa: string;
  payeeName: string;
  isConfigured: boolean;
}

export interface UpiPaymentParams {
  vpa: string;
  payeeName: string;
  amount: number;
  transactionRef: string;
  note: string;
}

const UPI_VPA_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

export function isValidUpiVpa(vpa: string): boolean {
  return UPI_VPA_REGEX.test(vpa.trim());
}

export function buildDefaultShopVpa(shopName: string): string {
  const slug = shopName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 18);
  return `${slug || 'gramsetushop'}@upi`;
}

function getStorageKey(shopId: number): string {
  return `gramsetu_upi_config_v1_${shopId}`;
}

export function loadShopUpiConfig(shopId: number, shopName: string): ShopUpiConfig {
  const fallback: ShopUpiConfig = {
    vpa: buildDefaultShopVpa(shopName),
    payeeName: shopName,
    isConfigured: false,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(getStorageKey(shopId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ShopUpiConfig>;
    if (parsed.vpa && isValidUpiVpa(parsed.vpa)) {
      return {
        vpa: parsed.vpa.trim(),
        payeeName: (parsed.payeeName || shopName).trim(),
        isConfigured: true,
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return fallback;
}

export function saveShopUpiConfig(shopId: number, vpa: string, payeeName: string): ShopUpiConfig {
  const cleaned: ShopUpiConfig = {
    vpa: vpa.trim(),
    payeeName: payeeName.trim() || 'Kirana Store',
    isConfigured: true,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getStorageKey(shopId), JSON.stringify(cleaned));
    } catch {
      // Ignore storage write errors
    }
  }
  return cleaned;
}

export function buildUpiPaymentUri(params: UpiPaymentParams): string {
  const searchParams = new URLSearchParams();
  searchParams.set('pa', params.vpa.trim());
  searchParams.set('pn', params.payeeName.trim());
  searchParams.set('am', Math.max(0.01, params.amount).toFixed(2));
  searchParams.set('cu', 'INR');
  searchParams.set('tr', params.transactionRef.trim());
  searchParams.set('tn', params.note.trim().slice(0, 60));
  return `upi://pay?${searchParams.toString()}`;
}

export function generateBillPaymentRef(shopId: number): string {
  const now = new Date();
  const stamp = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes()
  ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `GS${shopId}-${stamp}`;
}

export async function generateUpiQrDataUrl(upiUri: string): Promise<string> {
  return QRCode.toDataURL(upiUri, {
    width: 280,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0D2818',
      light: '#FFFFFF',
    },
  });
}
