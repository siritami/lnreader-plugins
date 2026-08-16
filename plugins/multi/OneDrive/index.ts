import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';
import { ContentType } from '@libs/pluginMetadata';

type GraphItem = {
  id: string;
  name: string;
  size?: number;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  parentReference?: { path?: string };
  '@microsoft.graph.downloadUrl'?: string;
};

type GraphChildrenResponse = {
  value: GraphItem[];
  '@odata.nextLink'?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type DeviceCodeResponse = {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  message?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
};

class OneDrivePlugin implements Plugin.PluginBase {
  id = 'yuneko.onedrive';
  name = 'OneDrive';
  icon = 'src/multi/onedrive/icon.png';
  site = 'https://onedrive.live.com';
  version = '2.0.0';
  contentType = ContentType.VIDEO;

  pluginSettings: Plugin.PluginSettings = {
    clientId: {
      value: '',
      label: 'Microsoft Entra application client ID',
      type: 'Text',
    },
    folder: {
      value: '',
      label: 'OneDrive folder path',
      type: 'Text',
    },
  };

  private setting(name: string): string {
    return (storage.get(name) || this.pluginSettings[name]?.value || '') as string;
  }

  private get folder(): string {
    return this.setting('folder').trim().replace(/^\/+|\/+$/g, '');
  }

  private async requestToken(refreshToken: string): Promise<string> {
    const clientId = this.setting('clientId').trim();
    if (!clientId) throw new Error('Configure the Microsoft Entra client ID first.');
    const response = await fetchApi(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'Files.Read offline_access User.Read',
        }).toString(),
      },
    );
    const data = (await response.json()) as TokenResponse;
    if (!response.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || 'Microsoft Graph login failed.');
    }
    if (data.refresh_token) storage.set('refreshToken', data.refresh_token);
    storage.set('accessToken', data.access_token);
    return data.access_token;
  }

  private async deviceLogin(): Promise<string> {
    const clientId = this.setting('clientId').trim();
    if (!clientId) throw new Error('Configure the Microsoft Entra client ID first.');

    let deviceCode = this.setting('deviceCode').trim();
    if (!deviceCode) {
      const response = await fetchApi(
        'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            scope: 'Files.Read offline_access User.Read',
          }).toString(),
        },
      );
      const data = (await response.json()) as DeviceCodeResponse;
      if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
        throw new Error(data.error_description || data.error || 'Unable to start Microsoft login.');
      }
      deviceCode = data.device_code;
      storage.set('deviceCode', deviceCode);
      throw new Error(
        `${data.message || 'Open the verification URL and enter the code.'} Then retry the plugin.`,
      );
    }

    const response = await fetchApi(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
        }).toString(),
      },
    );
    const data = (await response.json()) as TokenResponse;
    if (!response.ok || !data.access_token) {
      if (data.error === 'authorization_pending') {
        throw new Error('Microsoft login is not finished. Complete it, then retry the plugin.');
      }
      if (data.error === 'expired_token') storage.delete('deviceCode');
      throw new Error(data.error_description || data.error || 'Microsoft login failed.');
    }
    storage.delete('deviceCode');
    if (data.refresh_token) storage.set('refreshToken', data.refresh_token);
    storage.set('accessToken', data.access_token);
    return data.access_token;
  }

  private async accessToken(): Promise<string> {
    const accessToken = this.setting('accessToken').trim();
    if (accessToken) return accessToken;
    const refreshToken = this.setting('refreshToken').trim();
    if (refreshToken) return this.requestToken(refreshToken);
    return this.deviceLogin();
  }

  private async graph<T>(url: string, retry = true): Promise<T> {
    const response = await fetchApi(url, {
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
    });
    if (response.status === 401 && retry && this.setting('refreshToken')) {
      storage.delete('accessToken');
      await this.requestToken(this.setting('refreshToken'));
      return this.graph<T>(url, false);
    }
    const data = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || `Graph request failed (${response.status}).`);
    return data;
  }

  private pathFor(item: GraphItem, path: string): string {
    const params = new URLSearchParams();
    params.set('id', item.id);
    params.set('path', path);
    params.set('name', item.name);
    return `/onedrive?${params.toString()}`;
  }

  private async children(url: string): Promise<GraphItem[]> {
    const result = await this.graph<GraphChildrenResponse>(url);
    const items = [...result.value];
    if (result['@odata.nextLink']) items.push(...(await this.children(result['@odata.nextLink'])));
    return items;
  }

  private async listVideos(): Promise<Array<{ item: GraphItem; path: string }>> {
    const root = this.folder
      ? `https://graph.microsoft.com/v1.0/me/drive/root:/${this.folder
          .split('/')
          .map(encodeURIComponent)
          .join('/')}:\/children`
      : 'https://graph.microsoft.com/v1.0/me/drive/root/children';
    const videos: Array<{ item: GraphItem; path: string }> = [];
    const walk = async (url: string, parentPath: string): Promise<void> => {
      for (const item of await this.children(url)) {
        const path = parentPath ? `${parentPath}/${item.name}` : item.name;
        if (item.folder) {
          await walk(`https://graph.microsoft.com/v1.0/me/drive/items/${item.id}/children`, path);
        } else if (/\.(mp4|mkv|ts)$/i.test(item.name)) {
          videos.push({ item, path });
        }
      }
    };
    await walk(root, this.folder);
    return videos;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];
    return (await this.listVideos()).map(({ item, path }) => ({
      name: path,
      path: this.pathFor(item, path),
      cover: defaultCover,
    }));
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];
    const query = searchTerm.toLowerCase();
    return (await this.popularNovels(1)).filter(item =>
      item.name.toLowerCase().includes(query),
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const params = new URLSearchParams(novelPath.split('?')[1] || '');
    const name = params.get('name') || 'Video';
    return {
      path: novelPath,
      name,
      cover: defaultCover,
      status: NovelStatus.Ongoing,
      chapters: [{ name, path: novelPath, chapterNumber: 1 }],
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const params = new URLSearchParams(chapterPath.split('?')[1] || '');
    const id = params.get('id');
    if (!id) throw new Error('Invalid OneDrive video ID.');
    const result = await this.graph<GraphItem>(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(id)}`,
    );
    const url = result['@microsoft.graph.downloadUrl'];
    if (!url) throw new Error('Microsoft Graph did not return a playable download URL.');

    return [
      '<meta name="lnreader-chapter-type" content="video">',
      '<meta name="lnreader-video-mode" content="direct">',
      '<meta name="lnreader-video-type" content="video-file">',
      `<meta name="lnreader-video-url" content="${this.escapeAttribute(url)}">`,
      '<meta id="no-cache-marker">',
      '<meta id="no-prefetch-marker">',
    ].join('\n');
  }

  private escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  resolveUrl(): string {
    return this.site;
  }
}

export default new OneDrivePlugin();
