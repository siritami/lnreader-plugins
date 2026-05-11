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
- Bạn cần viết toàn bộ mã nguồn của plugin vào một tệp TypeScript duy nhất (ví dụ: `plugins/vietnamese/LNHako.ts`).

### 2. Các loại Plugin hỗ trợ

Dự án hiện tại hỗ trợ 2 khuôn mẫu plugin chính: `PluginBase` và `PagePlugin`.
- **`PluginBase`**: Loại plugin cơ bản và thông dụng nhất. Hầu hết các trang web novel đều có thể sử dụng khuôn mẫu này.
- **`PagePlugin`**: Là bản mở rộng (extends) từ `PluginBase`, được thiết kế riêng cho các trang web phân trang chương truyện (ví dụ: Web truyenfull chia danh sách 1000 chương thành nhiều trang, mỗi trang chứa 50 chương).

> **Tham khảo:** Bạn có thể tham khảo mẫu cấu trúc (template) của `PluginBase` tại `plugins/vietnamese/template.ts`, và mẫu của `PagePlugin` tại `plugins/vietnamese/template2.ts`.

### 3. Đăng ký Plugin

Để plugin của bạn được biên dịch thành gói JavaScript bundle hoàn chỉnh, bạn cần đăng ký (import) plugin đó vào tệp `plugins/index.ts` và đưa nó vào mảng danh sách xuất (export) `PLUGINS`.

Việc đăng kí sẽ được thực hiện tự động khi bạn sử dụng lệnh `npm run dev:start`

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

## Hướng dẫn Debug (Gỡ lỗi)

Trong quá trình phát triển Plugin, chắc chắn bạn sẽ cần kiểm tra xem code của mình có hoạt động đúng hay không. Môi trường phát triển của Repository này đã tích hợp sẵn một giao diện Web (Web UI) để mô phỏng hoạt động của ứng dụng LNReader ngay trên trình duyệt.

### 1. Khởi chạy môi trường test cục bộ (Local Web Interface)

Mở terminal và chạy lệnh sau:
```bash
npm run dev:start
```

- Lệnh này sẽ tự động biên dịch toàn bộ các files và khởi chạy một Web Server mô phỏng.
- Bạn có thể truy cập vào địa chỉ được hiển thị trên console (thường là `http://localhost:5173` hoặc `http://localhost:3000`).
- Giao diện này cho phép bạn tương tác trực tiếp: duyệt danh sách truyện mới, tìm kiếm, xem danh sách chương truyện và nội dung trang đọc giống như một người dùng đang sử dụng LNReader.

### 2. Sử dụng `console.log`

- Vì code của bạn đang chạy thông qua trình duyệt ở giao diện Web, bạn hoàn toàn có thể sử dụng `console.log`, `console.warn`, hoặc `console.error` ngay bên trong các hàm xử lý của Plugin (`popularNovels`, `parseNovel`, `parseChapter`,...).
- **Cách xem:** Mô phỏng các thao tác tương ứng trên Web UI (ví dụ ấn vào xem truyện), ấn phím **F12** để mở Developer Tools của trình duyệt (Chrome, Edge...), chuyển sang tab `Console` và theo dõi quá trình in kết quả.

### 3. Debug lỗi kẹt tại Fetch API hoặc Parse HTML

- Nếu truyện không tải được danh sách, hãy mở **tab Network** trong Developer Tools để xem các request lấy HTML có trả về nội dung kỳ vọng hay bị chặn (Block/CORS/Cloudflare).
- Nếu Request trả về nội dung đúng (Status 200) nhưng thông tin hiển thị lên trang web lại sai/trống, bạn hãy dùng `console.log` hiển thị các biến lưu kết quả parse (`cheerio`) trước khi `return` để kiểm tra độ chính xác của Selectors CSS mà bạn cung cấp. Quá trình này giúp phát hiện trường hợp phía website đã thay đổi giao diện làm bộ lọc cũ không hoạt động.

## Một số lưu ý khi sử dụng plugin tương thích với [LNReader-Extended](https://github.com/Yuneko-dev/lnreader-extended)

### 1. Sử dụng các thư viện tương thích với ứng dụng

- `@libs/aes`: Đã bổ sung `ctr`, `ecb`, `cbc`, `cfb`, `gcmsiv`, `aeskw`, `aeskwp`, `cmac` và `aessiv`, dựa trên thư viện `@noble/ciphers/aes.js`

- `@libs/utils`: Đã bổ sung các hàm `utf8ToBytes`, `bytesToUtf8`; `Buffer` (polyfill, sử dụng như Buffer của Node.js), `encodeHtmlEntities` và `decodeHtmlEntities` dựa trên thư viện `html-entities`

- `@libs/fetch`: xóa bỏ `fetchFile` (do ứng dụng gốc cũng không có)

- `@libs/cookie`: (Xem typing TypeScript) Một bộ API tương tác với `@preeternal/react-native-cookie-manager` (có giới hạn)

### 2. Các hành vi mới của ứng dụng

#### API dùng để buộc tải lại 1 chapter truyện (bỏ qua cache):

```js
window.reader.refetch();
```

hoặc

```js
window.reader.post({ type: 'refetch' });
```

#### Làm thế nào để ứng dụng không cache chương hiện tại?

- Thêm vào phản hồi của `parseChapter` một thẻ meta có id `no-cache-marker`

```html
<meta id="no-cache-marker"/>
```

#### Làm thế nào để ứng dụng không tải chương tiếp theo?

- Thêm vào phản hồi của `parseChapter` một thẻ meta có id `no-prefetch-marker`

```html
<meta id="no-prefetch-marker"/>
```

### 3. Captcha và các vấn đề bên lề

- Ưu tiên mở trang Web bằng WebView rồi giải captcha.

- Nếu trang Web chặn WebView, có thể thử đổi User-Agent trong cài đặt.

- Nếu vẫn không được, có thể render Captcha trực tiếp trong màn hình Reader. Tuy nhiên, vì hàm `parseChapter` đã được chuẩn hóa, nên script và các thẻ khác có thể không chạy. Sử dụng customJS để xử lý hành vi.

- Trong Reader, URL (location) mặc định sử dụng sẽ là URL site của plugin (Không phải URL của Chapter)
