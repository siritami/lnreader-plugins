import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { Filters } from '@libs/filterInputs';

const API_BASE = 'https://api.mottruyen.com';

interface MtStoryData {
  ID: string;
  NAME: string;
  CHAPTER: Array<{ id: string; name: string }>;
  TOTALCHAPTER: string;
  IMG: string;
  CAT: string;
  AUTHOR: string;
  TRANS: string;
  DESC: string;
  THUMB: string;
}

interface MtChapterData {
  EID: string;
  ID: string;
  ORDER: string;
  CONTENT: string;
  NAME: string;
  ENAME: string;
  PREV: string;
  NEXT: string;
  UNAME: string;
}

interface MtApiResponse<T> {
  success: number;
  data: T;
  errorCode: number;
  errorMessage: string;
}

class MotTruyenPlugin implements Plugin.PluginBase {
  id = 'mottruyen';
  name = 'Mọt Truyện';
  icon = 'src/vi/mottruyen/icon.png';
  site = 'https://mottruyen.com';
  version = '1.0.0';

  async popularNovels(
    pageNo: number,
    options: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    // API does not expose a browse/popular endpoint.
    // Users should search by story_id.
    return [];
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const storyId = novelPath;
    const url = `${API_BASE}/story/?story_id=${storyId}`;
    const res = await fetchApi(url);
    const json: MtApiResponse<MtStoryData> = await res.json();

    if (json.success !== 1 || !json.data) {
      throw new Error(json.errorMessage || 'Không tìm thấy truyện');
    }

    const d = json.data;

    const summary = (d.DESC || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();

    const authorParts: string[] = [];
    if (d.AUTHOR) authorParts.push(d.AUTHOR);
    if (d.TRANS) authorParts.push(d.TRANS);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: d.NAME || 'Không có tiêu đề',
      cover: d.IMG || d.THUMB || defaultCover,
      author: authorParts.join(' | '),
      genres: d.CAT || '',
      summary,
      status: NovelStatus.Unknown,
    };

    // Build chapter list from first chapter ID + total
    const totalChapters = parseInt(d.TOTALCHAPTER, 10) || 0;
    const firstChapter = d.CHAPTER?.[0];

    if (firstChapter && totalChapters > 0) {
      const firstChapId = parseInt(firstChapter.id, 10);
      const chapters: Plugin.ChapterItem[] = [];

      for (let i = 0; i < totalChapters; i++) {
        const chapId = firstChapId + i;
        chapters.push({
          name: i === 0 ? firstChapter.name : `Chương ${i + 1}`,
          path: String(chapId),
          chapterNumber: i + 1,
        });
      }
      novel.chapters = chapters;
    }

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = `${API_BASE}/chapter/?chapter_id=${chapterPath}`;
    const res = await fetchApi(url);
    const json: MtApiResponse<MtChapterData> = await res.json();

    if (json.success !== 1 || !json.data) {
      throw new Error(json.errorMessage || 'Không tìm thấy chương');
    }

    const d = json.data;
    let content = d.CONTENT || '';

    // Remove uploader watermark tag at the beginning if present
    content = content.replace(
      /^<p>Người đăng:.*?<\/p>/i,
      '',
    );

    const title = d.ENAME || '';
    if (title) {
      content = `<h2>${title}</h2>${content}`;
    }

    return content;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    // The API has no search endpoint.
    // Accept a numeric story_id as the search term.
    const storyId = searchTerm.trim();
    if (!storyId || isNaN(Number(storyId))) {
      return [];
    }

    try {
      const url = `${API_BASE}/story/?story_id=${storyId}`;
      const res = await fetchApi(url);
      const json: MtApiResponse<MtStoryData> = await res.json();

      if (json.success !== 1 || !json.data) {
        return [];
      }

      return [
        {
          name: json.data.NAME,
          path: json.data.ID,
          cover: json.data.IMG || json.data.THUMB || defaultCover,
        },
      ];
    } catch {
      return [];
    }
  }

  resolveUrl(path: string, isNovel?: boolean): string {
    if (isNovel) {
      return `${API_BASE}/story/?story_id=${path}`;
    }
    return `${API_BASE}/chapter/?chapter_id=${path}`;
  }

  filters = {} satisfies Filters;
}

export default new MotTruyenPlugin();
