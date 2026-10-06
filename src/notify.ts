// 系统通知（tauri-plugin-notification）：应用在后台时也能收到压缩结果提醒
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionChecked = false;

export async function notify(title: string, body?: string): Promise<void> {
  try {
    if (!permissionChecked) {
      permissionChecked = true;
      if (!(await isPermissionGranted())) {
        await requestPermission();
      }
    }
    sendNotification({ title, body });
  } catch {
    // 非桌面环境 / 权限被拒：静默忽略，不影响压缩主流程
  }
}
