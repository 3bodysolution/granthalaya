-- Join up accents that were saved as a separate mark (a + macron) so every font draws them properly.
update public.titles set title = normalize(title, NFC) where title <> normalize(title, NFC);
update public.titles set creator = normalize(creator, NFC) where creator <> normalize(creator, NFC);
update public.titles set original_title = normalize(original_title, NFC) where original_title <> normalize(original_title, NFC);
