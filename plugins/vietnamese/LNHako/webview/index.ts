const chapterComments = document.querySelector('#chapter-comments');
const host = document.querySelector('#shadow-host');
if (chapterComments && host) {
  const shadow = host.attachShadow({ mode: 'open' });
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
    shadow.appendChild(node.cloneNode(true));
  });
  shadow.appendChild(chapterComments);
  const prepareComments = (section: Element, baseUrl: string) => {
    section
      .querySelectorAll(
        '#fbcmt_root > span, .ln-comment_sign-in, .ln-comment > header, .ln-comment > script, #ln-comment-submit, .do-like, .do-reply, .my-auto, .fas.fa-chevron-down, .comment_see_more, .leading-tight, .loading, img[src*="/images/frames"], .ln-comment-toolkit',
      )
      .forEach(node => node.remove());

    section.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
      const href = link.getAttribute('href');
      if (!href) {
        return;
      }

      if (link.closest('.ln-comment-page')) {
        link.dataset.commentPageUrl = new URL(href, baseUrl).toString();
        link.setAttribute('href', '#comment-page');
      } else if (href.startsWith('/')) {
        if (link.hasAttribute('target')) {
          link.remove();
        } else {
          link.setAttribute('href', '#skip-link');
        }
      }
    });
  };

  prepareComments(chapterComments, document.baseURI);
  shadow.addEventListener('click', async event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const pageLink = target.closest<HTMLAnchorElement>(
      '.ln-comment-page a[data-comment-page-url]',
    );
    if (pageLink) {
      event.preventDefault();
      const url = pageLink.dataset.commentPageUrl;
      if (!url || pageLink.classList.contains('disabled')) {
        return;
      }

      pageLink.setAttribute('aria-busy', 'true');
      try {
        const response = await window.reader.fetch(url);
        if (!response.ok) {
          return;
        }
        const html = await response.text();
        const nextDocument = new DOMParser().parseFromString(html, 'text/html');
        const nextComments = nextDocument.querySelector('#chapter-comments');
        if (nextComments) {
          prepareComments(nextComments, url);
          chapterComments.innerHTML = nextComments.innerHTML;
        }
      } finally {
        pageLink.removeAttribute('aria-busy');
      }
      return;
    }

    if (!target.matches('.comment-spoiler-reveal')) {
      return;
    }

    const spoiler = target.closest('[data-comment-spoiler]');
    const content = spoiler?.querySelector('[data-comment-content]');
    if (!spoiler || !content) {
      return;
    }

    content.removeAttribute('aria-hidden');
    target.setAttribute('aria-expanded', 'true');
    target.remove();
  });
  host.setAttribute('id', 'chapter-comments');
}
