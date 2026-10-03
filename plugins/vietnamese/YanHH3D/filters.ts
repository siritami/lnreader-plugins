import { type Filters, FilterTypes } from '@libs/filterInputs';

export default {
  orderby: {
    type: FilterTypes.Picker,
    label: 'Sắp xếp theo',
    value: 'modified',
    options: [
      { label: 'Mới cập nhật', value: 'modified' },
      { label: 'Ngày đăng', value: 'date' },
      { label: 'Tên phim', value: 'title' },
    ],
  },
  order: {
    type: FilterTypes.Picker,
    label: 'Thứ tự',
    value: 'desc',
    options: [
      { label: 'Giảm dần (Mới nhất / Z-A)', value: 'desc' },
      { label: 'Tăng dần (Cũ nhất / A-Z)', value: 'asc' },
    ],
  },
  category: {
    type: FilterTypes.Picker,
    label: 'Thể loại',
    value: '',
    options: [
      { label: 'Tất cả', value: '' },
      { label: 'Tu Tiên', value: '25' },
      { label: 'Tiên Hiệp', value: '24' },
      { label: 'Kiếm Hiệp', value: '23' },
      { label: 'Trùng Sinh', value: '21' },
      { label: 'Xuyên Không', value: '1' },
      { label: 'Cổ Trang', value: '15' },
      { label: 'Đô Thị', value: '17' },
      { label: 'Hiện Đại', value: '22' },
      { label: 'Hài Hước', value: '19' },
    ],
  },
  status: {
    type: FilterTypes.Picker,
    label: 'Trạng thái',
    value: '',
    options: [
      { label: 'Tất cả', value: '' },
      { label: 'Đang chiếu', value: '2' },
      { label: 'Hoàn thành', value: '12' },
      { label: 'Trailer', value: '13' },
    ],
  },
  showtimes: {
    type: FilterTypes.Picker,
    label: 'Lịch chiếu',
    value: '',
    options: [
      { label: 'Tất cả', value: '' },
      { label: 'Thứ 2', value: '5' },
      { label: 'Thứ 3', value: '6' },
      { label: 'Thứ 4', value: '7' },
      { label: 'Thứ 5', value: '8' },
      { label: 'Thứ 6', value: '9' },
      { label: 'Thứ 7', value: '10' },
      { label: 'Chủ Nhật', value: '4' },
    ],
  },
} satisfies Filters;
