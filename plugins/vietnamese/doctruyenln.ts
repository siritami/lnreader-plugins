import { CheerioAPI, load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { FilterTypes, Filters } from '@libs/filterInputs';

class DocTruyenLNPlugin implements Plugin.PagePlugin {
    id = 'doctruyenln';
    name = 'DocTruyenLN';
    icon = 'src/vi/doctruyenln/icon.png';
    site = 'https://quykiep.com';
    version = '1.0.3';

    imageRequestInit = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
    };

    private absoluteUrl(path?: string): string | undefined {
        if (!path) return undefined;
        return path.startsWith('http') ? path : `${this.site}${path}`;
    }

    private getCover(element: any, loadedCheerio: CheerioAPI): string | undefined {
        const noscriptHtml = element.find('noscript').html();
        let cover = noscriptHtml?.match(/src[sS]et="([^"]+)"/)?.[1]?.split(',')[0].trim().split(' ')[0]
            || noscriptHtml?.match(/src="([^"]+)"/)?.[1];

        if (!cover || cover.startsWith('data:')) {
            element.find('img').each((_: any, img: any) => {
                const $img = loadedCheerio(img);
                const src = $img.attr('src');
                if (src && !src.startsWith('data:') && (src.includes('static.') || src.includes('/Data/'))) {
                    cover = src;
                    return false;
                }
                const srcset = $img.attr('srcset')?.split(',')[0].trim().split(' ')[0];
                if (srcset && !srcset.startsWith('data:')) {
                    cover = srcset;
                    return false;
                }
            });
        }

        return this.absoluteUrl(cover);
    }

    parseNovels(loadedCheerio: CheerioAPI) {
        const novels: Plugin.NovelItem[] = [];

        const novelItems = loadedCheerio('div[itemtype*="Book"], div.flex.flex-col:has(a[href*="/truyen/"])');

        novelItems.each((_, ele) => {
            const data = loadedCheerio(ele);
            const titleEl = data.find('a[href*="/truyen/"]').filter((_, el) => {
                const $el = loadedCheerio(el);
                return $el.find('h3').length > 0 || $el.attr('title') !== undefined;
            }).first();

            const name = titleEl.attr('title') || titleEl.find('h3').text().trim() || data.find('h3').text().trim();
            const path = titleEl.attr('href') || data.find('a[href*="/truyen/"]').first().attr('href');

            if (!name || !path) return;

            const cover = this.getCover(data, loadedCheerio);

            if (name.length > 2 && !novels.some(n => n.path === path)) {
                novels.push({ name, path, cover });
            }
        });
        return novels;
    }

    async popularNovels(
        pageNo: number,
        options: Plugin.PopularNovelsOptions<typeof this.filters>,
    ): Promise<Plugin.NovelItem[]> {
        const sortValue = options.filters?.sort?.value || 'truyen-hot-ds';
        let url = `${this.site}/${sortValue}`;

        if (pageNo > 1) {
            url += `?page=${pageNo}`;
        }

        const result = await fetchApi(url);
        const body = await result.text();
        const loadedCheerio = parseHTML(body);

        return this.parseNovels(loadedCheerio);
    }

    async parseNovel(
        novelPath: string,
    ): Promise<Plugin.SourceNovel & { totalPages: number }> {
        const url = this.site + novelPath;
        const result = await fetchApi(url);
        const body = await result.text();

        const canonical = body.match(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/i)?.[1];
        if (canonical === `${this.site}/`) {
            throw new Error('Truyện không thể truy cập truyện này do Website đã chặn!');
        }

        const loadedCheerio = parseHTML(body);
        const novel: Plugin.SourceNovel & { totalPages: number } = {
            path: novelPath,
            name: loadedCheerio('h1').text().trim() || 'Không có tiêu đề',
            chapters: [],
            totalPages: 1,
            cover: this.absoluteUrl(loadedCheerio('meta[property="og:image"]').attr('content')),
            author: loadedCheerio('a[href^="/tac-gia/"]').first().text().trim(),
        };

        const introSection = loadedCheerio('#bookIntro').length ? loadedCheerio('#bookIntro') : loadedCheerio('[itemprop="description"]');
        novel.summary = introSection.find('p, li, b')
            .map((_, el) => loadedCheerio(el).text().trim())
            .get()
            .filter(Boolean)
            .join('\n');

        const genres: string[] = [];
        loadedCheerio('a[itemprop="genre"], div.flex.flex-wrap.gap-2 > a[href*="/truyen-"], div.flex.flex-wrap.gap-2 > a[href*="/tag/"]')
            .each((_, el) => {
                const text = loadedCheerio(el).text().trim();
                if (text && !genres.includes(text)) genres.push(text);
            });
        novel.genres = genres.join(',');

        const statusText = loadedCheerio('body').text();
        if (statusText.includes('Hoàn thành')) {
            novel.status = NovelStatus.Completed;
        } else if (statusText.includes('Đang ra')) {
            novel.status = NovelStatus.Ongoing;
        } else {
            novel.status = NovelStatus.Unknown;
        }

        const chapterListUrl = `${url}/danh-sach-chuong`;
        const chapterResult = await fetchApi(chapterListUrl);
        const chapterBody = await chapterResult.text();
        const chapterCheerio = parseHTML(chapterBody);

        let lastPage = 1;
        chapterCheerio('a[href*="page="]').each((_, el) => {
            const page = Number(chapterCheerio(el).attr('href')?.match(/page=(\d+)/)?.[1]);
            if (page > lastPage) lastPage = page;
        });
        novel.totalPages = lastPage;
        novel.chapters = this.parseChapters(chapterCheerio);

        return novel;
    }

    parseChapters(loadedCheerio: CheerioAPI): Plugin.ChapterItem[] {
        const chapters: Plugin.ChapterItem[] = [];
        loadedCheerio('a[href*="/chuong-"]').each((i, el) => {
            if (i === 0) return;
            const $el = loadedCheerio(el);
            const name = $el.text().trim();
            const path = $el.attr('href');
            if (name && path && path.includes('/chuong-') && !chapters.some(c => c.path === path)) {
                chapters.push({ name, path, releaseTime: '' });
            }
        });
        return chapters;
    }

    async parsePage(novelPath: string, page: string): Promise<Plugin.SourcePage> {
        const url = `${this.site}${novelPath}/danh-sach-chuong?page=${page}`;
        const result = await fetchApi(url);
        const body = await result.text();

        return {
            chapters: this.parseChapters(parseHTML(body)),
        };
    }

    async parseChapter(chapterPath: string): Promise<string> {
        const result = await fetchApi(this.site + chapterPath);
        const body = await result.text();
        const loadedCheerio = parseHTML(body);

        const contentContainer = loadedCheerio('#chapter-content, .chapter-content, .chapter-c, div.text-justify').first();
        contentContainer.find('script, iframe, ins, .ads, .ads-container').remove();

        return contentContainer.html() || loadedCheerio('body').text() || '';
    }

    async searchNovels(
        searchTerm: string,
        pageNo: number,
    ): Promise<Plugin.NovelItem[]> {
        const searchUrl = `${this.site}/api/book-search`;

        const result = await fetchApi(searchUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': this.site,
                'Referer': `${this.site}/tim-kiem`,
                'User-Agent': this.imageRequestInit.headers['User-Agent'],
            },
            body: JSON.stringify({ keyword: searchTerm }),
        });

        const json = await result.json() as { data: any[] };
        return (json.data || []).map(item => ({
            name: item.name,
            path: `/truyen/${item.slug}`,
            cover: this.absoluteUrl(item.coverUrl),
        })).filter(novel => novel.name && novel.path);
    }

    filters = {
        sort: {
            type: FilterTypes.Picker,
            label: 'Sắp xếp',
            value: 'truyen-hot-ds',
            options: [
                { label: 'Truyện mới cập nhật', value: 'truyen-moi-ds' },
                { label: 'Truyện hot', value: 'truyen-hot-ds' },
                { label: 'Truyện full', value: 'truyen-full-ds' },
                { label: 'Truyện dịch', value: 'truyen-dich-ds' },
            ],
        },
    } satisfies Filters;
}

export default new DocTruyenLNPlugin();
