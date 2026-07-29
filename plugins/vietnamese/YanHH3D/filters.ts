import { FilterTypes, type Filters } from '@libs/filterInputs';

const filters: Filters = {
  category: {
    type: FilterTypes.Select,
    label: 'Thể loại',
    value: '',
    options: [
      { label: 'Mới cập nhật', value: '/moi-cap-nhat' },
      { label: 'Hoạt Hình 3D', value: '/hoat-hinh-3d' },
      { label: 'Hoạt Hình 2D', value: '/hoat-hinh-2d' },
      { label: 'Hoạt Hình 4K', value: '/hoat-hinh-4k' },
      { label: 'Đã hoàn thành', value: '/hoan-thanh' },
      { label: 'Đang chiếu', value: '/dang-chieu' },
      { label: 'Phim lẻ | Ova', value: '/phim-le' },
    ],
  },
  genre: {
    type: FilterTypes.Select,
    label: 'Genre',
    value: '',
    options: [
      { label: 'Huyền Huyễn', value: '/the-loai/huyen-huyen' },
      { label: 'Xuyên Không', value: '/the-loai/xuyen-khong' },
      { label: 'Trùng Sinh', value: '/the-loai/trung-sinh' },
      { label: 'Tiên Hiệp', value: '/the-loai/tien-hiep' },
      { label: 'Cổ Trang', value: '/the-loai/co-trang' },
      { label: 'Hài Hước', value: '/the-loai/hai-huoc' },
      { label: 'Kiếm Hiệp', value: '/the-loai/kiem-hiep' },
      { label: 'Hiện Đại', value: '/the-loai/hien-dai' },
    ],
  },
};

export default filters;
