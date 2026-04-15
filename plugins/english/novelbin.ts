import { CheerioAPI, load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';

class NovelBin implements Plugin.PagePlugin {
    id = 'novelbin.me';
    name = 'Novel Bin';
    icon = 'src/en/novelbin/icon.png';
    site = 'https://novelbin.me';
    version = '1.0.2';

    headers = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://novelbin.me/',
    };

    parseNovels(loadedCheerio: CheerioAPI): Plugin.NovelItem[] {
        const novels: Plugin.NovelItem[] = [];
        loadedCheerio('.list.list-novel > .row').each((idx, ele) => {
            const titleEl = loadedCheerio(ele).find('h3.novel-title > a');
            const novelName = titleEl.text().trim();
            const novelUrl = titleEl.attr('href');

            const imgEl = loadedCheerio(ele).find('img.cover');
            let novelCover =
                imgEl.attr('data-src') || imgEl.attr('src') || defaultCover;
            const regex = /\/novel_\d+_\d+\//;
            const match = novelCover.match(regex);
            if (match) {
                novelCover = novelCover.replace(match[0], '/novel/');
            }
            if (novelUrl && novelName) {
                novels.push({
                    name: novelName,
                    cover: novelCover,
                    path: novelUrl.replace(this.site, ''),
                });
            }
        });

        return novels;
    }

    parseChapterList(loadedCheerio: CheerioAPI): Plugin.ChapterItem[] {
        return loadedCheerio('ul.list-chapter > li > a')
            .toArray()
            .map(ele => {
                const href = ele.attribs['href'] || '';
                const path = href.replace(this.site, '');
                const name =
                    loadedCheerio(ele).find('span').text().trim() ||
                    loadedCheerio(ele).text().trim();
                const chapterMatch = name.match(/Chapter\s+([\d.]+)/i);
                return {
                    name,
                    path,
                    chapterNumber: chapterMatch ? Number(chapterMatch[1]) : undefined,
                };
            });
    }

    async popularNovels(
        pageNo: number,
        { filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
    ): Promise<Plugin.NovelItem[]> {
        let url = `${this.site}/sort/novelbin-hot?page=${pageNo}`;

        if (filters) {
            const status = filters.status?.value || '';
            if (filters.tag?.value) {
                url = `${this.site}/tag/${encodeURIComponent(filters.tag.value)}${status}?page=${pageNo}`;
            } else if (filters.genre?.value) {
                url = `${this.site}/novelbin-genres/${filters.genre.value}${status}?page=${pageNo}`;
            } else if (filters.sort?.value) {
                url = `${this.site}/sort/${filters.sort.value}?page=${pageNo}`;
            }
        }

        const result = await fetchApi(url, { headers: this.headers });
        const body = await result.text();
        const loadedCheerio = parseHTML(body);
        return this.parseNovels(loadedCheerio);
    }

    async parseNovel(
        novelPath: string,
    ): Promise<Plugin.SourceNovel & { totalPages: number }> {
        const url = this.site + novelPath;
        const result = await fetchApi(url, { headers: this.headers });
        const body = await result.text();
        const loadedCheerio = parseHTML(body);

        const novel: Plugin.SourceNovel & { totalPages: number } = {
            path: novelPath,
            name: '',
            chapters: [],
            totalPages: 1,
        };

        novel.name =
            loadedCheerio('.col-info-desc .desc h3.title').first().text().trim() ||
            loadedCheerio('meta[property="og:novel:novel_name"]').attr('content') ||
            loadedCheerio('.books .desc h3.title').text().trim() ||
            'Unknown';

        const bookImg = loadedCheerio('.books .book img');
        novel.cover =
            bookImg.attr('data-src') ||
            bookImg.attr('src') ||
            loadedCheerio('meta[property="og:image"]').attr('content') ||
            defaultCover;

        const sumary = loadedCheerio('.desc-text').text().trim();
        const tags = loadedCheerio('.tag-container a')
            .map((index, element) => {
                let text = loadedCheerio(element).text().trim();
                return text.split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
            })
            .get()
            .join(', ');
        novel.summary = `Tags : ${tags}\n\n${sumary}`

        const authorLi = loadedCheerio('ul.info-meta li').filter((_, el) => {
            return loadedCheerio(el).find('h3').text().includes('Author');
        });
        novel.author = authorLi.find('a').text().trim();

        const genreLi = loadedCheerio('ul.info-meta li').filter((_, el) => {
            return loadedCheerio(el).find('h3').text().includes('Genre');
        });
        novel.genres = genreLi
            .find('a')
            .map((_, el) => loadedCheerio(el).text().trim())
            .toArray()
            .join(',');

        const statusLi = loadedCheerio('ul.info-meta li').filter((_, el) => {
            return loadedCheerio(el).find('h3').text().includes('Status');
        });
        const statusText = statusLi.find('a').text().trim().toLowerCase();

        if (statusText.includes('ongoing')) {
            novel.status = NovelStatus.Ongoing;
        } else if (statusText.includes('completed') || statusText.includes('full')) {
            novel.status = NovelStatus.Completed;
        } else {
            novel.status = NovelStatus.Unknown;
        }

        const ratingText = loadedCheerio('span[itemprop="ratingValue"]')
            .text()
            .trim();
        if (ratingText) {
            novel.rating = parseFloat(ratingText) / 2;
        }

        const novelId = novelPath.replace('/novel-book/', '');
        const ajaxUrl = `${this.site}/ajax/chapter-archive?novelId=${novelId}`;
        const ajaxResult = await fetchApi(ajaxUrl, { headers: this.headers });
        const ajaxBody = await ajaxResult.text();
        const ajaxCheerio = parseHTML(ajaxBody);
        novel.chapters = this.parseChapterList(ajaxCheerio);
        novel.totalPages = 1;

        return novel;
    }

    async parsePage(
        novelPath: string,
        page: string,
    ): Promise<Plugin.SourcePage> {
        const novelId = novelPath.replace('/novel-book/', '');
        const ajaxUrl = `${this.site}/ajax/chapter-archive?novelId=${novelId}`;
        const result = await fetchApi(ajaxUrl, { headers: this.headers });
        const body = await result.text();
        const loadedCheerio = parseHTML(body);
        const chapters = this.parseChapterList(loadedCheerio);

        return { chapters };
    }

    async parseChapter(chapterPath: string): Promise<string> {
        const url = this.site + chapterPath;
        const result = await fetchApi(url, { headers: this.headers });
        const body = await result.text();
        if (body.includes('Just a moment...')) {
            throw new Error('Please go to Webview and check Captcha');
        }
        const loadedCheerio = parseHTML(body);

        loadedCheerio('#chr-content script').remove();
        loadedCheerio('#chr-content .ads').remove();
        loadedCheerio('#chr-content .ads-holder').remove();
        loadedCheerio('#chr-content .ad').remove();
        loadedCheerio('#chr-content ins').remove();
        loadedCheerio('#chr-content iframe').remove();

        let chapterText = loadedCheerio('#chr-content').html();

        if (!chapterText) {
            chapterText = loadedCheerio('#chapter-content').html();
        }
        if (!chapterText) {
            chapterText = loadedCheerio('.chapter-content').html();
        }
        if (!chapterText) {
            chapterText = loadedCheerio('.chr-c').html();
        }

        return chapterText || '';
    }

    async searchNovels(
        searchTerm: string,
        pageNo: number,
    ): Promise<Plugin.NovelItem[]> {
        const searchUrl = `${this.site}/search?keyword=${encodeURIComponent(searchTerm)}&page=${pageNo}`;

        const result = await fetchApi(searchUrl, { headers: this.headers });
        const body = await result.text();
        const loadedCheerio = parseHTML(body);
        return this.parseNovels(loadedCheerio);
    }

    filters = {
        sort: {
            type: FilterTypes.Picker,
            label: 'Sort By (Disabled if Genre/Tag selected)',
            value: 'novelbin-hot',
            options: [
                { label: 'Hot', value: 'novelbin-hot' },
                { label: 'Latest Release', value: 'novelbin-daily-update' },
                { label: 'Completed', value: 'novelbin-complete' },
                { label: 'Most Popular', value: 'novelbin-popular' },
            ],
        },
        genre: {
            type: FilterTypes.Picker,
            label: 'Genre (Disabled if Tag selected)',
            value: '',
            options: [
                { label: 'All', value: '' },
                { label: 'Action', value: 'action' },
                { label: 'Adventure', value: 'adventure' },
                { label: 'Anime & Comics', value: 'anime-&-comics' },
                { label: 'Comedy', value: 'comedy' },
                { label: 'Drama', value: 'drama' },
                { label: 'Eastern', value: 'eastern' },
                { label: 'Fan-fiction', value: 'fan-fiction' },
                { label: 'Fantasy', value: 'fantasy' },
                { label: 'Game', value: 'game' },
                { label: 'Gender Bender', value: 'gender-bender' },
                { label: 'Harem', value: 'harem' },
                { label: 'Historical', value: 'historical' },
                { label: 'Horror', value: 'horror' },
                { label: 'Isekai', value: 'isekai' },
                { label: 'Josei', value: 'josei' },
                { label: 'Litrpg', value: 'litrpg' },
                { label: 'Magic', value: 'magic' },
                { label: 'Magical Realism', value: 'magical-realism' },
                { label: 'Martial Arts', value: 'martial-arts' },
                { label: 'Mature', value: 'mature' },
                { label: 'Mecha', value: 'mecha' },
                { label: 'Military', value: 'military' },
                { label: 'Modern Life', value: 'modern-life' },
                { label: 'Mystery', value: 'mystery' },
                { label: 'Psychological', value: 'psychological' },
                { label: 'Reincarnation', value: 'reincarnation' },
                { label: 'Romance', value: 'romance' },
                { label: 'School Life', value: 'school-life' },
                { label: 'Sci-fi', value: 'sci-fi' },
                { label: 'Seinen', value: 'seinen' },
                { label: 'Shoujo', value: 'shoujo' },
                { label: 'Shoujo Ai', value: 'shoujo-ai' },
                { label: 'Shounen', value: 'shounen' },
                { label: 'Shounen Ai', value: 'shounen-ai' },
                { label: 'Slice of Life', value: 'slice-of-life' },
                { label: 'Smut', value: 'smut' },
                { label: 'Sports', value: 'sports' },
                { label: 'Supernatural', value: 'supernatural' },
                { label: 'System', value: 'system' },
                { label: 'Thriller', value: 'thriller' },
                { label: 'Tragedy', value: 'tragedy' },
                { label: 'Urban', value: 'urban' },
                { label: 'Video Games', value: 'video-games' },
                { label: 'War', value: 'war' },
                { label: 'Wuxia', value: 'wuxia' },
                { label: 'Xianxia', value: 'xianxia' },
                { label: 'Xuanhuan', value: 'xuanhuan' },
                { label: 'Yaoi', value: 'yaoi' },
                { label: 'Yuri', value: 'yuri' },
            ],
        },
        tag: {
            type: FilterTypes.Picker,
            label: 'Tag',
            value: '',
            options: [
                { label: 'All', value: '' },
                { label: 'Ability Steal', value: 'ABILITY STEAL' },
                { label: 'Absent Parents', value: 'ABSENT PARENTS' },
                { label: 'Academy', value: 'ACADEMY' },
                { label: 'Accelerated Growth', value: 'ACCELERATED GROWTH' },
                { label: 'Acting', value: 'ACTING' },
                { label: 'Adapted to Anime', value: 'ADAPTED TO ANIME' },
                { label: 'Adapted to Drama CD', value: 'ADAPTED TO DRAMA CD' },
                { label: 'Adapted to Game', value: 'ADAPTED TO GAME' },
                { label: 'Adapted to Manhua', value: 'ADAPTED TO MANHUA' },
                { label: 'Adopted Children', value: 'ADOPTED CHILDREN' },
                { label: 'Alchemy', value: 'ALCHEMY' },
                { label: 'Aliens', value: 'ALIENS' },
                { label: 'Alternate World', value: 'ALTERNATE WORLD' },
                { label: 'Apathetic Protagonist', value: 'APATHETIC PROTAGONIST' },
                { label: 'Archery', value: 'ARCHERY' },
                { label: 'Aristocracy', value: 'ARISTOCRACY' },
                { label: 'Army', value: 'ARMY' },
                { label: 'Arrogant Characters', value: 'ARROGANT CHARACTERS' },
                { label: 'Artifacts', value: 'ARTIFACTS' },
                { label: 'Assassins', value: 'ASSASSINS' },
                { label: 'Award Winning Work', value: 'AWARD WINNING WORK' },
                { label: 'Battle Academy', value: 'BATTLE ACADEMY' },
                { label: 'Beast Companions', value: 'BEAST COMPANIONS' },
                { label: 'Beautiful Female Lead', value: 'BEAUTIFUL FEMALE LEAD' },
                { label: 'Black Belly', value: 'BLACK BELLY' },
                { label: 'Blacksmith', value: 'BLACKSMITH' },
                { label: 'Bloodlines', value: 'BLOODLINES' },
                { label: 'Body Tempering', value: 'BODY TEMPERING' },
                { label: 'Broken Engagement', value: 'BROKEN ENGAGEMENT' },
                { label: 'Business Management', value: 'BUSINESS MANAGEMENT' },
                { label: 'Calm Protagonist', value: 'CALM PROTAGONIST' },
                { label: 'Caring Protagonist', value: 'CARING PROTAGONIST' },
                { label: 'Cautious Protagonist', value: 'CAUTIOUS PROTAGONIST' },
                { label: 'Character Growth', value: 'CHARACTER GROWTH' },
                { label: 'Childcare', value: 'CHILDCARE' },
                { label: 'Clever Protagonist', value: 'CLEVER PROTAGONIST' },
                { label: 'Cold Protagonist', value: 'COLD PROTAGONIST' },
                { label: 'Comedic Undertone', value: 'COMEDIC UNDERTONE' },
                { label: 'Complex Family Relationships', value: 'COMPLEX FAMILY RELATIONSHIPS' },
                { label: 'Cooking', value: 'COOKING' },
                { label: 'Cross Dressing', value: 'CROSS DRESSING' },
                { label: 'Cultivation', value: 'CULTIVATION' },
                { label: 'Cunning Protagonist', value: 'CUNNING PROTAGONIST' },
                { label: 'Curses', value: 'CURSES' },
                { label: 'Dark', value: 'DARK' },
                { label: 'Death', value: 'DEATH' },
                { label: 'Death of Loved Ones', value: 'DEATH OF LOVED ONES' },
                { label: 'Dense Protagonist', value: 'DENSE PROTAGONIST' },
                { label: 'Depictions of Cruelty', value: 'DEPICTIONS OF CRUELTY' },
                { label: 'Destiny', value: 'DESTINY' },
                { label: 'Detectives', value: 'DETECTIVES' },
                { label: 'Determined Protagonist', value: 'DETERMINED PROTAGONIST' },
                { label: 'Devoted Love Interests', value: 'DEVOTED LOVE INTERESTS' },
                { label: 'Doctors', value: 'DOCTORS' },
                { label: 'Dolls Puppets', value: 'DOLLS PUPPETS' },
                { label: 'Doting Love Interests', value: 'DOTING LOVE INTERESTS' },
                { label: 'Dragons', value: 'DRAGONS' },
                { label: 'Dungeons', value: 'DUNGEONS' },
                { label: 'Dwarfs', value: 'DWARFS' },
                { label: 'Eidetic Memory', value: 'EIDETIC MEMORY' },
                { label: 'Elves', value: 'ELVES' },
                { label: 'Empires', value: 'EMPIRES' },
                { label: 'Enemies Become Allies', value: 'ENEMIES BECOME ALLIES' },
                { label: 'Evil Gods', value: 'EVIL GODS' },
                { label: 'Evil Organizations', value: 'EVIL ORGANIZATIONS' },
                { label: 'Evil Religions', value: 'EVIL RELIGIONS' },
                { label: 'Evolution', value: 'EVOLUTION' },
                { label: 'Familial Love', value: 'FAMILIAL LOVE' },
                { label: 'Family', value: 'FAMILY' },
                { label: 'Famous Protagonist', value: 'FAMOUS PROTAGONIST' },
                { label: 'Fantasy Creatures', value: 'FANTASY CREATURES' },
                { label: 'Fantasy World', value: 'FANTASY WORLD' },
                { label: 'Fast Learner', value: 'FAST LEARNERS' },
                { label: 'Female Protagonist', value: 'FEMALE PROTAGONIST' },
                { label: 'Firearms', value: 'FIREARMS' },
                { label: 'Futuristic Setting', value: 'FUTURISTIC SETTING' },
                { label: 'Game Elements', value: 'GAME ELEMENTS' },
                { label: 'Game Ranking System', value: 'GAME RANKING SYSTEM' },
                { label: 'Gamers', value: 'GAMERS' },
                { label: 'Genetic Modifications', value: 'GENETIC MODIFICATIONS' },
                { label: 'Genius Protagonist', value: 'GENIUS PROTAGONIST' },
                { label: 'Ghosts', value: 'GHOSTS' },
                { label: 'God Protagonist', value: 'GOD PROTAGONIST' },
                { label: 'Goddesses', value: 'GODDESSES' },
                { label: 'Godly Powers', value: 'GODLY POWERS' },
                { label: 'Gods', value: 'GODS' },
                { label: 'Gore', value: 'GORE' },
                { label: 'Grinding', value: 'GRINDING' },
                { label: 'Guilds', value: 'GUILDS' },
                { label: 'Handsome Male Lead', value: 'HANDSOME MALE LEAD' },
                { label: 'Hard Working Protagonist', value: 'HARD WORKING PROTAGONIST' },
                { label: 'Herbalist', value: 'HERBALIST' },
                { label: 'Hidden Abilities', value: 'HIDDEN ABILITIES' },
                { label: 'Hiding True Abilities', value: 'HIDING TRUE ABILITIES' },
                { label: 'Hiding True Identity', value: 'HIDING TRUE IDENTITY' },
                { label: 'Industrialization', value: 'INDUSTRIALIZATION' },
                { label: 'Interdimensional Travel', value: 'INTERDIMENSIONAL TRAVEL' },
                { label: 'Kingdoms', value: 'KINGDOMS' },
                { label: 'Knights', value: 'KNIGHTS' },
                { label: 'Kuudere', value: 'KUUDERE' },
                { label: 'Level System', value: 'LEVEL SYSTEM' },
                { label: 'Love Interest Falls in Love First', value: 'LOVE INTEREST FALLS IN LOVE FIRST' },
                { label: 'Loyal Subordinates', value: 'LOYAL SUBORDINATES' },
                { label: 'Lucky Protagonist', value: 'LUCKY PROTAGONIST' },
                { label: 'Magic Beasts', value: 'MAGIC BEASTS' },
                { label: 'Male Protagonist', value: 'MALE PROTAGONIST' },
                { label: 'Male Yandere', value: 'MALE YANDERE' },
                { label: 'Marriage', value: 'MARRIAGE' },
                { label: 'Master-Disciple Relationship', value: 'MASTER-DISCIPLE RELATIONSHIP' },
                { label: 'Medical Knowledge', value: 'MEDICAL KNOWLEDGE' },
                { label: 'Mercenaries', value: 'MERCENARIES' },
                { label: 'MMORPG', value: 'MMORPG' },
                { label: 'Modern Knowledge', value: 'MODERN KNOWLEDGE' },
                { label: 'Monsters', value: 'MONSTERS' },
                { label: 'Multiple POV', value: 'MULTIPLE POV' },
                { label: 'Multiple Realms', value: 'MULTIPLE REALMS' },
                { label: 'Mutated Creatures', value: 'MUTATED CREATURES' },
                { label: 'Mysterious Family Background', value: 'MYSTERIOUS FAMILY BACKGROUND' },
                { label: 'Mythical Beasts', value: 'MYTHICAL BEASTS' },
                { label: 'Older Love Interests', value: 'OLDER LOVE INTERESTS' },
                { label: 'Overpowered Protagonist', value: 'OVERPOWERED PROTAGONIST' },
                { label: 'Past Plays a Big Role', value: 'PAST PLAYS A BIG ROLE' },
                { label: 'Pets', value: 'PETS' },
                { label: 'Pill Concocting', value: 'PILL CONCOCTING' },
                { label: 'Poisons', value: 'POISONS' },
                { label: 'Politics', value: 'POLITICS' },
                { label: 'Poor to Rich', value: 'POOR TO RICH' },
                { label: 'Power Couple', value: 'POWER COUPLE' },
                { label: 'Previous Life Talent', value: 'PREVIOUS LIFE TALENT' },
                { label: 'Proactive Protagonist', value: 'PROACTIVE PROTAGONIST' },
                { label: 'R-18', value: 'R-18' },
                { label: 'Reincarnated in Another World', value: 'REINCARNATED IN ANOTHER WORLD' },
                { label: 'Romantic Subplot', value: 'ROMANTIC SUBPLOT' },
                { label: 'Royalty', value: 'ROYALTY' },
                { label: 'Ruthless Protagonist', value: 'RUTHLESS PROTAGONIST' },
                { label: 'Schemes and Conspiracies', value: 'SCHEMES AND CONSPIRACIES' },
                { label: 'Second Chance', value: 'SECOND CHANCE' },
                { label: 'Secret Organizations', value: 'SECRET ORGANIZATIONS' },
                { label: 'Shameless Protagonist', value: 'SHAMELESS PROTAGONIST' },
                { label: 'Sharp Tongued Characters', value: 'SHARP TONGUED CHARACTERS' },
                { label: 'Siblings', value: 'SIBLINGS' },
                { label: 'Sister Complex', value: 'SISTER COMPLEX' },
                { label: 'Skill Books', value: 'SKILL BOOKS' },
                { label: 'Store Owner', value: 'STORE OWNER' },
                { label: 'Strength Based Social Hierarchy', value: 'STRENGTH BASED SOCIAL HIERARCHY' },
                { label: 'Sword and Magic', value: 'SWORD AND MAGIC' },
                { label: 'Sword Wielder', value: 'SWORD WIELDER' },
                { label: 'Tragic Past', value: 'TRAGIC PAST' },
                { label: 'Transmigration', value: 'TRANSMIGRATION' },
                { label: 'Underestimated Protagonist', value: 'UNDERESTIMATED PROTAGONIST' },
                { label: 'Unique Weapon User', value: 'UNIQUE WEAPON USER' },
                { label: 'Virtual Reality', value: 'VIRTUAL REALITY' },
                { label: 'Wars', value: 'WARS' },
                { label: 'Weak to Strong', value: 'WEAK TO STRONG' },
                { label: 'Wealthy Characters', value: 'WEALTHY CHARACTERS' },
                { label: 'Younger Sisters', value: 'YOUNGER SISTERS' },
            ],
        },
        status: {
            type: FilterTypes.Picker,
            label: 'Status (Genre & Tag only)',
            value: '',
            options: [
                { label: 'All Novels', value: '' },
                { label: 'Completed Novels Only', value: '/completed' },
            ],
        },
    } satisfies Filters;
}

export default new NovelBin();
