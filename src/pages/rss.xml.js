import rss from '@astrojs/rss';
import { getEntries } from '../lib/data';
import { site } from '../data/site';

export async function GET(context) {
  const all = await getEntries();
  const verb = { book: 'Read', film: 'Watched', essay: 'Saved' };
  return rss({
    title: site.name,
    description: site.description,
    site: context.site,
    items: all.slice(0, 50).map((e) => ({
      title: `${verb[e.data.type]}: ${e.data.title}`,
      pubDate: e.data.date,
      description: `${e.data.creator}. ${(e.body ?? '').split('\n\n')[0]}`,
      link: `/library/${e.id}/`,
    })),
  });
}
