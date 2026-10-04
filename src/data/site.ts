// Settings for the site and for its owner.
// The site (name, address) is shared. Everything under `owner` belongs to one person's shelf,
// so when friends join later, each of them gets their own copy of the `owner` part.
export const site = {
  name: 'Granthalaya',
  url: 'https://granthalaya-sarthak.vercel.app',
  description: 'Books, films and everything I’ve spent time with.',

  owner: {
    id: 'sarthak',            // short, lowercase; used in sign-in and, later, in web addresses
    name: 'Sarthak',
    // Small line above the big headline on the home page.
    season: 'Monsoon 2026',
    // "Thinking about" card on the home page, and the big quote on the Notes page.
    lineOfTheWeek: {
      text: 'Clouds come floating into my life, no longer to carry rain or usher storm, but to add color to my sunset sky.',
      by: 'Rabindranath Tagore',
      source: 'Stray Birds',
      year: 1916,
    },
    // Reading pace used to estimate time spent on books (minutes per page).
    minutesPerPage: 1.1,
    // Reading speed used for essays (words per minute).
    wordsPerMinute: 230,
    // The one goal shown on the Stats page.
    goal: { label: 'Books this year', target: 30 },
    // Where the footer looks for rain (it rains in the painting when it rains here).
    weather: { lat: 18.52, lon: 73.86 },
  },

  // Covers: 'real' shows real book covers and film posters where we have them (public/covers/),
  // 'painted' shows the painted covers everywhere.
  covers: 'real' as 'real' | 'painted',
};

// Shortcut for the person whose shelf this is.
export const me = site.owner;
