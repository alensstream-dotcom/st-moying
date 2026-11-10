/** User-confirmed hairstyle corrections are not limited to the legacy profile extractor. */
export function inspectHairTags(raw: string) {
  const tokens = [
    ...new Set(
      raw
        .replace(/```(?:[a-z]+)?/gi, '')
        .replace(/_/g, ' ')
        .split(/[,，、;；\n]+/)
        .map((t) =>
          t
            .trim()
            .replace(/^[\s*•\-]+/, '')
            .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
            .replace(/^[+-]?\d+(?:\.\d+)?::/, '')
            .replace(/::$/, '')
            .replace(/\s+/g, ' '),
        )
        .filter(Boolean),
    ),
  ];
  const invalid = tokens.filter(
    (t) =>
      !/^[a-zA-Z0-9 ()'\-]+$/.test(t) ||
      t.length > 100 ||
      /\b(?:artist|quality|masterpiece|dress|shirt|breasts|skin|wet|windswept|expression|smile|background)\b/i.test(
        t,
      ) ||
      /(?:art|drawing|painting) style/i.test(t) ||
      (/\beyes?\b/i.test(t) && !/\b(?:hair|bangs)\b/i.test(t)),
  );
  const unusual = tokens.filter(
    (t) =>
      !invalid.includes(t) &&
      !/\b(?:hair|hairstyle|bangs|ahoge|sidelocks|sideburns|ponytails?|twintails|braids?|braided|bun|buns|chignon|updo|bob|pixie|undercut|dreadlocks|cornrows|mohawk|hime|curls?|ringlets|drills?|cropped|bald|blonde?|black|silver|white|brown|red|pink|blue|green|purple|gray|grey|short|long|medium|length)\b/i.test(
        t,
      ),
  );
  return { tags: tokens.join(', '), invalid, unusual };
}
