// 设备预设：尺寸、像素比、是否移动端（桌面版会同时模拟 UA 与触摸）。
export interface Device { id: string; label: string; w: number; h: number; dpr: number; mobile: boolean; group: string; ua?: string }

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36';

export const DEVICES: Device[] = [
  { id: 'fill', label: '自适应（填满）', w: 0, h: 0, dpr: 1, mobile: false, group: '响应式' },
  { id: 'd1920', label: '桌面 1920×1080', w: 1920, h: 1080, dpr: 1, mobile: false, group: '桌面' },
  { id: 'd1440', label: '笔记本 1440×900', w: 1440, h: 900, dpr: 2, mobile: false, group: '桌面' },
  { id: 'd1280', label: '小屏 1280×800', w: 1280, h: 800, dpr: 1, mobile: false, group: '桌面' },
  { id: 'd2560', label: '2K 2560×1440', w: 2560, h: 1440, dpr: 1, mobile: false, group: '桌面' },
  { id: 'ipadpro', label: 'iPad Pro 1024×1366', w: 1024, h: 1366, dpr: 2, mobile: true, group: '平板', ua: IPAD_UA },
  { id: 'ipadair', label: 'iPad Air 820×1180', w: 820, h: 1180, dpr: 2, mobile: true, group: '平板', ua: IPAD_UA },
  { id: 'ipadmini', label: 'iPad mini 768×1024', w: 768, h: 1024, dpr: 2, mobile: true, group: '平板', ua: IPAD_UA },
  { id: 'iphone16pm', label: 'iPhone 16 Pro Max 440×956', w: 440, h: 956, dpr: 3, mobile: true, group: '手机', ua: IOS_UA },
  { id: 'iphone16', label: 'iPhone 16 Pro 402×874', w: 402, h: 874, dpr: 3, mobile: true, group: '手机', ua: IOS_UA },
  { id: 'iphonese', label: 'iPhone SE 375×667', w: 375, h: 667, dpr: 2, mobile: true, group: '手机', ua: IOS_UA },
  { id: 'pixel9', label: 'Pixel 9 412×915', w: 412, h: 915, dpr: 2.625, mobile: true, group: '手机', ua: ANDROID_UA },
  { id: 'galaxy', label: 'Galaxy S24 360×780', w: 360, h: 780, dpr: 3, mobile: true, group: '手机', ua: ANDROID_UA },
];
export const deviceById = (id: string) => DEVICES.find((d) => d.id === id) || DEVICES[0];
export const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
