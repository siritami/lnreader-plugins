# Tài liệu phát triển LNReader Plugins

Tài liệu này cung cấp các hướng dẫn cơ bản để cài đặt môi trường và phát triển plugin cho LNReader.

## Cài đặt dự án

**Yêu cầu cơ bản:**
- Kiến thức về Git và TypeScript.
- Cài đặt [Node.js](https://nodejs.org/) phiên bản 24 trở lên.

**Các bước cài đặt:**
Mở terminal tại thư mục gốc của dự án và chạy lệnh sau để cài đặt các thư viện phụ thuộc:
```bash
npm install
```

## Hướng dẫn tạo Plugin

### 1. Vị trí tạo Plugin

- Tất cả các plugin được đặt trong thư mục `plugins`.
- Do repository này tập trung hỗ trợ các nền tảng Web Novel tiếng Việt, vui lòng tạo hoặc đặt plugin của bạn bên trong thư mục `plugins/vietnamese`.
- Bạn có thể viết toàn bộ mã nguồn của plugin vào một tệp TypeScript duy nhất (ví dụ: `plugins/vietnamese/LNHako.ts`), hoặc tạo một thư mục riêng biệt cho từng plugin nếu mã nguồn quá dài và phức tạp.

### 2. Các loại Plugin hỗ trợ

Dự án hiện tại hỗ trợ 2 khuôn mẫu plugin chính: `PluginBase` và `PagePlugin`.
- **`PluginBase`**: Loại plugin cơ bản và thông dụng nhất. Hầu hết các trang web novel đều có thể sử dụng khuôn mẫu này.
- **`PagePlugin`**: Là bản mở rộng (extends) từ `PluginBase`, được thiết kế riêng cho các trang web phân trang chương truyện (ví dụ: Web truyenfull chia danh sách 1000 chương thành nhiều trang, mỗi trang chứa 50 chương).

> **Tham khảo:** Bạn có thể tham khảo mẫu cấu trúc (template) của `PluginBase` tại `plugins/vietnamese/template.ts`, và mẫu của `PagePlugin` tại `plugins/vietnamese/template2.ts`.

### 3. Đăng ký Plugin

Để plugin của bạn được biên dịch thành gói JavaScript bundle hoàn chỉnh, bạn cần đăng ký (import) plugin đó vào tệp `plugins/index.ts` và đưa nó vào mảng danh sách xuất (export) `PLUGINS`.

**Lưu ý:** Dự án sử dụng module CommonJS nên khi viết cú pháp import, bạn không cần thêm đuôi `.js` vào đường dẫn tệp (khác với cấu trúc ESM).

**Ví dụ cách đăng ký tại `plugins/index.ts`:**
```ts
import { Plugin } from '@/types/plugin';

// Import instance của các plugin bạn vừa tạo
import p_0 from '@plugins/vietnamese/template';
import p_1 from '@plugins/vietnamese/template2';

// Khai báo mảng chứa plugin
const PLUGINS: Plugin.PluginBase[] = [
  p_0, 
  p_1
];

// Xuất mảng để hệ thống có thể nhận diện và biên dịch
export default PLUGINS;
```
