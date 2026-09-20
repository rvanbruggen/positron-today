# Duplicate articles — full automation period (2026-08-20 → 2026-09-08)

> **Corrected 2026-09-08.** The first version of this report said each redundant publish left an
> extra `articles` row, and that every extra row re-posted to social. That was wrong. Production had
> only **4** duplicate rows, and the story committed twelve times has exactly **one** row. The
> duplication was never in Positronitron's article insert — it was in the publish step.

- `Add post` commits: **1067** for **573** distinct articles
- Articles committed more than once: **331**
- Redundant commits: **494**
- Every duplicate set landed within 5 minutes of itself — all concurrency.

## What actually happened

`publishScheduledArticles()` selects every due `scheduled` row, commits each to GitHub, and only
then marks them published. The select and the mark are separated by a full GitHub round trip, and
the function has **four callers that overlap constantly**:

1. the NAS cron, every 30 minutes
2. `publish-timer.ts` — **one `setTimeout` per scheduled article**, each firing a run that publishes
   the *whole* due set (this is the multiplier that got one story to twelve commits)
3. two call sites in `unified-pipeline.ts`

All of them saw the same rows as still `scheduled`, so all of them committed.

**The site never showed duplicates** because every repeat wrote the same path and overwrote the
last — which is exactly why this hid behind a clean-looking site for three weeks. The real costs
were wasted GitHub API calls and duplicate social announcements: `postPendingSocial()` has the same
shape (`social_posted_at IS NULL` read, then a Post-for-Me call and an up-to-300s liveness wait,
then the write), so concurrent runs could announce the same article twice.

Fixed in **4.0.6** — both functions now take the same compare-and-swap lock as Positronitron,
inside the function rather than at a route, so every caller is serialised.

---

## Database cleanup — done

Ran on 2026-09-08 against `/data/positron.db`:

- 3 of the 4 duplicate rows deleted (2792 → 2789 articles)
- Backup at `/data/positron-pre-dedupe-2026-09-08T10-58-26-317Z.db`
- Verified afterwards: no orphaned `article_tags`, no orphaned editorial links, all 8 scheduled
  articles untouched

**One set still needs you** — `raw_article_id 4029`, the clover/orchards story from 14 August. Its
two rows point at two *different* live pages, so this one needs a page deleted, not just a row:

| Row | Published | Social | Page |
|-----|-----------|--------|------|
| 2235 | 11:01 | posted | `2026-08-14-clover-and-herbs-keep-fruit-orchards-up-to-20-degrees-cooler.md` |
| 2236 | 14:07 | — | `2026-08-14-clover-and-herbs-keep-fruit-plantations-up-to-20-degrees-coo.md` |

Suggest keeping **2235** — "orchards" is the better translation of the Dutch, and it is the one that
was announced socially. Delete the `plantations` file from `site/src/posts/` and row 2236, then
restart the container so the unique index installs.

---

## Articles published more than once

Sorted by repeat count, then first publish. Each extra copy is one duplicate `articles` row and one likely duplicate social post.

| # | Times | First published | Article |
|---|-------|-----------------|---------|
| 1 | 12× | 2026-08-26 10:34:41 | Seeing through murky waters |
| 2 | 12× | 2026-09-03 10:34:14 | Ancient sheep virus found hiding in medieval parchment |
| 3 | 11× | 2026-09-03 10:34:05 | Trail cameras catch elusive, endangered ocelots using wildlife crossing in Texas |
| 4 | 11× | 2026-09-03 10:34:09 | Functional chimeric mRNAs encode proteins in mammalian immunity |
| 5 | 10× | 2026-08-26 10:34:33 | Forces deep inside Earth helped Antarctica freeze before the Arctic |
| 6 | 9× | 2026-08-29 10:32:46 | New heart attack definition promises better care for women |
| 7 | 8× | 2026-08-28 10:33:21 | How Dutch volcanoes formed (and went extinct) |
| 8 | 8× | 2026-08-29 10:32:43 | End of destroying clothes. New regulations will change clothing brands' strategies |
| 9 | 8× | 2026-08-29 10:32:44 | Teacher donated $5,000 to plant trees in China. 27 years later, he’s moved to tears by the results. |
| 10 | 8× | 2026-09-01 14:34:30 | Could plastic-eating robots clean up our oceans? |
| 11 | 8× | 2026-09-01 14:34:32 | Nine out of ten new cars run on electricity |
| 12 | 8× | 2026-09-03 10:34:00 | Scientists discover a mysterious wave shaped like a decagon in Saturn's atmosphere |
| 13 | 7× | 2026-08-26 10:34:30 | Your brain may not actually “make” decisions |
| 14 | 7× | 2026-08-26 10:34:31 | Three forgotten kings could rewrite the history of ancient Assyria |
| 15 | 7× | 2026-08-28 10:33:20 | Archaeology student found a lost Maya city on page 16 of a Google search |
| 16 | 7× | 2026-08-28 10:33:26 | Stone rider from 11,000 years ago. New discovery in Karahan Tepe surprises scientists |
| 17 | 6× | 2026-08-29 10:30:58 | How journalists are winning back the trust of marginalized communities |
| 18 | 6× | 2026-09-03 10:33:54 | 46 years ago, Carl Sagan beautifully explained the fourth dimension using a sliced apple |
| 19 | 5× | 2026-08-26 10:34:25 | African agriculture offers key pathway to economic development and jobs |
| 20 | 5× | 2026-08-26 10:34:28 | To stop crop raids, this assam village grew 66 acres of food for wild elephants |
| 21 | 5× | 2026-08-28 10:33:18 | Inside India’s food-safety crackdown: how officers make kitchens, dairies & warehouses accountable |
| 22 | 5× | 2026-08-29 10:32:41 | Scientists debunk the main argument of employers. The myth of remote work has fallen |
| 23 | 5× | 2026-08-30 10:32:41 | NASA launches Roman space telescope: what Hubble sees in 100 years, she can observe in one month |
| 24 | 5× | 2026-08-30 10:32:42 | Why are we right-handed or left-handed? A study offers a new perspective |
| 25 | 5× | 2026-08-30 10:32:44 | Philippe Rahm, architect: building cactus cities to combat droughts and heatwaves |
| 26 | 5× | 2026-09-01 14:34:29 | Once it was pugmarks. Now it’s AI: how technology is helping protect India’s tigers |
| 27 | 5× | 2026-09-03 10:33:59 | Scientists measured campfire light and discovered its incredible role in shaping human language |
| 28 | 4× | 2026-08-30 10:32:39 | Nuclear tests reveal secrets of Earth's core. It's a vast anomaly |
| 29 | 4× | 2026-08-31 21:28:30 | It started with one man and a Rs 30 bowl. Today, 6,450 are keeping Tamil Nadu's birds from dying of thirst |
| 30 | 4× | 2026-08-31 21:28:33 | One injection could keep osteoarthritis drugs working for weeks |
| 31 | 4× | 2026-09-03 14:34:32 | IIT Guwahati finds a new way to remove harmful toxins from water |
| 32 | 4× | 2026-09-03 14:34:34 | What could go right? The made-to-order cancer vaccine |
| 33 | 4× | 2026-09-03 14:34:35 | The universe has plenty of hydrogen. So why is star formation collapsing? |
| 34 | 3× | 2026-08-26 14:34:28 | Protection of critical raw materials supply |
| 35 | 3× | 2026-08-29 18:30:44 | Can super coral and cooling the sea save reefs from climate change? |
| 36 | 3× | 2026-08-29 18:30:46 | Australia’s red soil may be hiding a massive clean energy source |
| 37 | 3× | 2026-08-30 10:32:37 | Popular food myth debunked. Scientists found the best source of protein |
| 38 | 3× | 2026-09-01 14:32:44 | Homesick silicon valley techies rebuilt a flood-wrecked karnataka school — and 150+ others |
| 39 | 3× | 2026-09-03 10:33:53 | These Antwerp rooftops prove that the most beautiful piece of green is sometimes above our heads |
| 40 | 3× | 2026-09-03 14:34:31 | Global initiative launched to improve access to mpox vaccines |
| 41 | 2× | 2026-08-20 12:04:01 | Ultra low emission zones linked to improved lung capacity in kids: UK study |
| 42 | 2× | 2026-08-20 12:36:01 | Africa: Eight more nations pledge new circular economy roadmaps |
| 43 | 2× | 2026-08-20 13:06:01 | Sound waves power these tiny drones |
| 44 | 2× | 2026-08-20 18:38:01 | The next big thing in hydrogen could be underground |
| 45 | 2× | 2026-08-20 19:02:01 | Scientists say the human family tree may need a major rewrite |
| 46 | 2× | 2026-08-20 19:31:01 | Knee osteoarthritis isn’t inevitable — here’s what you can do |
| 47 | 2× | 2026-08-20 20:03:01 | Scientists crushed diamond beyond Neptune-like pressures—and solved a 20-year mystery |
| 48 | 2× | 2026-08-20 20:38:01 | Humans have learned to fear ‘bugs’, but we shouldn’t – life as we know it hinges on invertebrates |
| 49 | 2× | 2026-08-20 21:09:01 | How one American couple ditched their lawn and created a wildlife haven – and you could too |
| 50 | 2× | 2026-08-20 21:32:01 | Africa: five African countries end polio outbreaks |
| 51 | 2× | 2026-08-20 22:06:01 | The mobile library bringing books to rural Syria |
| 52 | 2× | 2026-08-20 23:03:01 | Sacred forests, ancient rules: how India’s communities have protected nature for centuries |
| 53 | 2× | 2026-08-20 23:37:01 | Life’s ‘last universal common ancestor’ may predate life itself |
| 54 | 2× | 2026-08-21 00:04:01 | Moderna cancer vaccine stops melanoma returning: what’s next for personalized treatments? |
| 55 | 2× | 2026-08-21 00:36:01 | Physicists pinpoint the perfect crystal site for an ultra-accurate nuclear clock |
| 56 | 2× | 2026-08-21 01:01:01 | Footprints may reveal biggest known mammal from age of the dinosaurs |
| 57 | 2× | 2026-08-21 01:31:01 | Hidden volcanoes hint at Moon’s turbulent past |
| 58 | 2× | 2026-08-21 02:31:01 | Experimental drug generates immune response against pancreatic cancer in people at high risk |
| 59 | 2× | 2026-08-21 02:31:03 | 11 stunning images celebrating Earth’s life—and the scientists who study it |
| 60 | 2× | 2026-08-21 03:01:01 | Researcher, heal thyself: meet the scientists studying their own diseases |
| 61 | 2× | 2026-08-21 03:31:01 | Astronaut vest cuts radiation exposure in half |
| 62 | 2× | 2026-08-21 04:01:01 | Archaeologists triple the scale of an ancient Amazonian civilization we know almost nothing about |
| 63 | 2× | 2026-08-21 10:39:01 | Scientists smash atoms together to create ‘little’ big bangs |
| 64 | 2× | 2026-08-21 11:40:19 | Transforming Britain’s old coalfields into clean energy sources |
| 65 | 2× | 2026-08-21 11:40:21 | Rewilded land remains green amid drought-stricken English countryside, images show |
| 66 | 2× | 2026-08-22 10:52:01 | In 1870, a man claimed Margaret E. Knight couldn’t have made her invention. She challenged him and won. |
| 67 | 2× | 2026-08-22 18:36:01 | The health benefits of singing: 97 percent of people can sing |
| 68 | 2× | 2026-08-22 19:07:01 | How this 1960s ex-council house is managing to stay cool without air con |
| 69 | 2× | 2026-08-23 21:32:00 | Why do male blackbucks turn black? The science behind their striking coat |
| 70 | 2× | 2026-08-23 21:51:01 | 60 years ago NASA took the first ever photo of Earth from the moon |
| 71 | 2× | 2026-08-23 22:07:01 | How “thunderquakes” could help reveal hidden structures inside the Earth |
| 72 | 2× | 2026-08-23 22:19:01 | Finland tried to end homelessness. What can we learn from its runaway success – and recent failures? |
| 73 | 2× | 2026-08-23 22:39:19 | A plant-based organic diet is good for both the environment and health |
| 74 | 2× | 2026-08-23 22:46:01 | Transistors changed everything. Here’s how they work |
| 75 | 2× | 2026-08-23 23:07:01 | Why do hummingbirds buzz? Tiny tornadoes. |
| 76 | 2× | 2026-08-23 23:23:01 | This shark can live 400 years. Its eyes barely seem to age |
| 77 | 2× | 2026-08-23 23:36:01 | Black holes keep tearing these stars apart, but they survive |
| 78 | 2× | 2026-08-23 23:49:01 | London’s low emission zone is working – so why are cities around the world so cautious about clean air? |
| 79 | 2× | 2026-08-24 00:09:01 | Onshore windfarm applications hit 10-year high in England |
| 80 | 2× | 2026-08-24 00:23:01 | These are the 3 healthiest diets in the world. Nutritionist explains why: “Proven benefits for heart and blood vessels” |
| 81 | 2× | 2026-08-24 18:31:01 | From 61 malnourished girls to 20: how an IAS officer used AI to monitor school meals |
| 82 | 2× | 2026-08-24 19:37:01 | First stellar stream found beyond the Milky Way |
| 83 | 2× | 2026-08-24 21:34:01 | Engineers 3D-printed edible cookies from plastic |
| 84 | 2× | 2026-08-24 23:01:01 | New diet allows young bluefin tuna to thrive in warmer seas |
| 85 | 2× | 2026-08-25 18:35:15 | The future of peer review requires AI support, not AI bans |
| 86 | 2× | 2026-08-25 19:08:01 | First bluefin tuna caught in North Sea in 60 years is sign of healthy ecosystem |
| 87 | 2× | 2026-08-25 19:33:01 | Waste wood must help Agristo produce more climate-friendly fries |
| 88 | 2× | 2026-08-25 20:01:01 | Sophie Adenot prepares for her second spacewalk from the ISS |
| 89 | 2× | 2026-08-25 21:29:35 | IAS officer helps Varanasi use 1000 school & college rooftops to recharge groundwater |
| 90 | 2× | 2026-08-25 21:29:36 | NASA finds Earth microbes could survive on the Moon |
| 91 | 2× | 2026-08-25 21:38:01 | Scientists find hidden highways guiding animal evolution |
| 92 | 2× | 2026-08-25 22:04:01 | Supercharged “natural killer” cells could be a powerful new cancer weapon |
| 93 | 2× | 2026-08-25 22:40:29 | Atomic catalyst unlocks the hidden value of plant waste |
| 94 | 2× | 2026-08-26 05:39:01 | This is what a Jurassic forest may have sounded like |
| 95 | 2× | 2026-08-26 10:38:01 | Taking your temperature from the inside |
| 96 | 2× | 2026-08-26 11:01:01 | Amping up T cells to target cancer |
| 97 | 2× | 2026-08-26 11:38:01 | Agelab research inspires an A I startup |
| 98 | 2× | 2026-08-26 12:01:01 | Addressing a sticking point in sustainable adhesives |
| 99 | 2× | 2026-08-26 12:37:01 | Researchers presented 6000 papers at a major meeting. Could AI reproduce their findings? |
| 100 | 2× | 2026-08-26 13:04:01 | Hidden beneath the Wadden Sea lies a volcano |
| 101 | 2× | 2026-08-26 13:36:01 | Belgian company aims to join AI race by building chips 'upwards': why can't the next chip innovation come from Europe? |
| 102 | 2× | 2026-08-26 14:08:01 | Why this summer more sunflowers are coloring the Flemish fields |
| 103 | 2× | 2026-08-26 15:07:01 | A leak you can’t see could waste thousands of litres. Here’s how smart water meters catch it |
| 104 | 2× | 2026-08-26 15:36:01 | She got Lebanon to abolish the death penalty: 'A light in the darkness' |
| 105 | 2× | 2026-08-26 17:07:01 | Putting slugs on the map: farmers pioneer precision crop protection |
| 106 | 2× | 2026-08-26 18:38:01 | The baffling science of SSRIs: how do they really work? |
| 107 | 2× | 2026-08-26 19:06:01 | South Africa’s ‘registration law’ for scientists could be a template for the world — if the nation gets it right |
| 108 | 2× | 2026-08-26 19:34:01 | India’s lion populations increase 70%, total habitat by 15% over the last decade |
| 109 | 2× | 2026-08-27 14:38:01 | Before he died, an Idaho truck driver worked to turn an old bridge into a wildlife overpass. Now it's a lifeline for animals |
| 110 | 2× | 2026-08-27 14:52:01 | This frog has been 'invisible' to the science community for over a century |
| 111 | 2× | 2026-08-27 15:01:01 | NASA’s Roman telescope readies a sweeping view of the universe |
| 112 | 2× | 2026-08-27 15:20:01 | The humanoids at China’s robot games were faster than Usain Bolt—but I’m more impressed by their tweezer mastery |
| 113 | 2× | 2026-08-27 15:34:01 | Indigenous nations in present-day Georgia may have enjoyed cacao |
| 114 | 2× | 2026-08-27 15:51:01 | Scientists and volunteers take big step towards saving rare ‘cryptic’ Australian orchid |
| 115 | 2× | 2026-08-27 16:05:01 | UN recognizes restoration initiative feeding 4 million across the Sahel |
| 116 | 2× | 2026-08-27 16:20:01 | This 'hospital on wheels' reached 4000+ people. Its 8-step plan can work in villages too |
| 117 | 2× | 2026-08-27 17:07:01 | Scientists may have found a shortcut to calorie restriction’s anti-aging benefits |
| 118 | 2× | 2026-08-27 17:22:01 | Controversial Alzheimer’s surgery is said to reverse symptoms |
| 119 | 2× | 2026-08-27 18:49:01 | Amphibious stem-insect sheds light on colonization of land |
| 120 | 2× | 2026-08-27 19:09:01 | Systems vaccinology and the architecture of human immunity |
| 121 | 2× | 2026-08-27 19:21:01 | Automated prototyping of genetic codes |
| 122 | 2× | 2026-08-27 19:36:01 | Using nuclear waste to power space missions |
| 123 | 2× | 2026-08-27 19:51:01 | Volvo’s cars will warn one another about hazards in the road |
| 124 | 2× | 2026-08-27 20:09:01 | Naked mole rats make their own perfume—and it’s excellent birth control |
| 125 | 2× | 2026-08-27 20:21:01 | Butterfly wing crystals inspire new eco-friendly glitter |
| 126 | 2× | 2026-08-27 20:32:01 | Resurrecting plant inspires ‘fridge free’ vaccines that could save the millions of doses wasted annually |
| 127 | 2× | 2026-08-27 20:51:01 | Digital Hive uit Lummen toont hoe technologie landbouw kan helpen |
| 128 | 2× | 2026-08-27 21:07:01 | How this 40-YO Bengaluru home was rebuilt with almost nothing going to waste |
| 129 | 2× | 2026-08-27 21:17:01 | New NASA photos reveal 16 galaxies from across the cosmos in dazzling detail |
| 130 | 2× | 2026-08-27 21:32:02 | Wood foam startup uses logging waste as substitute for plastic, producing 400 pounds daily |
| 131 | 2× | 2026-08-27 22:53:01 | Key brain circuit regulating hibernation found at last |
| 132 | 2× | 2026-08-27 23:08:01 | Microduck is a robot built to fall down—and learn new tricks |
| 133 | 2× | 2026-08-27 23:17:01 | IAS officer quit job to trace the artists behind India’s 300-year-old miniature paintings |
| 134 | 2× | 2026-08-27 23:33:01 | The fascinating science of how India’s fish survive in freshwater and the sea |
| 135 | 2× | 2026-08-27 23:46:01 | Smart nanoparticles light up brain cancer and destroy what surgery misses |
| 136 | 2× | 2026-08-28 00:05:01 | 324-million-year-old fossil reveals how insects conquered land |
| 137 | 2× | 2026-08-28 00:24:01 | AI searched 100 million possibilities and found a cheaper way to 3D-print a NASA rocket alloy |
| 138 | 2× | 2026-08-28 00:32:01 | Your dislike of eating bugs may be 9,000 years old |
| 139 | 2× | 2026-08-28 00:50:01 | Astronomers spot Betelgeuse’s hidden companion |
| 140 | 2× | 2026-08-28 01:02:01 | Is the keto diet better than the Mediterranean? New clinical trial reveals health benefits |
| 141 | 2× | 2026-08-28 01:23:01 | I fight pain and fear with art: how Yayoi Kusama blazed a trail for neurodivergent artists |
| 142 | 2× | 2026-08-28 01:31:01 | A solution to the mystery of the missing neutrinos |
| 143 | 2× | 2026-08-28 01:47:01 | Animal-microbe partnerships date back to the dawn of complex life |
| 144 | 2× | 2026-08-28 02:04:01 | Scalable robot fish can easily swim in a creek or lake |
| 145 | 2× | 2026-08-28 02:19:01 | 88 years ago, she defied a judge’s order to wear a dress in court. She went to jail in pants. |
| 146 | 2× | 2026-08-28 02:33:01 | Pakistan combines river dolphin sanctuaries along the Indus River, protecting 250 miles of habitat |
| 147 | 2× | 2026-08-29 10:38:01 | Top 10 Roman Space Telescope science breakthroughs |
| 148 | 2× | 2026-08-29 11:06:01 | Scientists discovered 149 new deep-sea species near a collapsed volcano: 'It was a massive hole in the data' |
| 149 | 2× | 2026-08-29 11:31:01 | Camera traps capture adorable images of Costa Rica's 'sloth bridges,' built to help the slowpokes cross roads safely |
| 150 | 2× | 2026-08-29 12:04:01 | Researchers followed 400,000 kids for 20 years and found a lasting pre-K advantage |
| 151 | 2× | 2026-08-29 12:37:01 | Experimental eye drops help blind mice see again |
| 152 | 2× | 2026-08-29 13:03:01 | Amid Europe's record-breaking heat and drought, solar power made it possible to cope |
| 153 | 2× | 2026-08-29 13:32:01 | Does computer science need computers? |
| 154 | 2× | 2026-08-29 14:01:01 | Heisuke Hironaka obituary: mathematician who smoothed out geometry’s complexities |
| 155 | 2× | 2026-08-29 14:36:01 | The Moderna cancer vaccine offers hope — now we must speed up personalized therapies |
| 156 | 2× | 2026-08-29 15:06:01 | Marie Tharp, the cartographer who changed the history of geosciences |
| 157 | 2× | 2026-08-29 15:32:01 | The surprising science behind Japan’s vending machine obsession |
| 158 | 2× | 2026-08-29 16:03:01 | How do you tag the world’s biggest fish? Fins and flexibility. |
| 159 | 2× | 2026-08-29 16:38:01 | Frogs produce a protein that counters deadly shellfish toxin that’s being tested as an antidote in humans |
| 160 | 2× | 2026-08-29 18:38:01 | Scientists discover why damaged nerves struggle to heal |
| 161 | 2× | 2026-08-29 19:01:01 | Why your ability to cope with stress changes with time |
| 162 | 2× | 2026-08-29 19:32:01 | On the back of his gray T-shirt it says: 'I have your clothes on'. It's not a coincidence |
| 163 | 2× | 2026-08-29 20:09:01 | Psilocybin might make your brain live in the moment |
| 164 | 2× | 2026-08-29 20:38:01 | NASA’s Nancy Grace Roman Space Telescope Has a Hidden Technological Leap |
| 165 | 2× | 2026-08-29 21:02:01 | After just 1 school year, children's brains change significantly as they learn to read and write |
| 166 | 2× | 2026-08-29 21:36:01 | Stop worrying about range: How to navigate buying a used electric vehicle |
| 167 | 2× | 2026-08-29 22:02:01 | Young people are more than doomscrolling zombies on social platforms |
| 168 | 2× | 2026-08-29 22:36:02 | Researchers find hidden atherosclerosis in otherwise healthy young adults |
| 169 | 2× | 2026-08-29 23:02:01 | Scientists from Szczecin discover a new species of crustacean from the Norwegian coast |
| 170 | 2× | 2026-08-29 23:36:01 | Scientists turn one of the hardest plastics to recycle into high-performance engine lubricant |
| 171 | 2× | 2026-08-30 00:01:01 | The universe is still speeding up, but nobody knows why |
| 172 | 2× | 2026-08-30 00:32:01 | Dogs may hold surprising clues to human longevity |
| 173 | 2× | 2026-08-30 01:06:01 | Keto diet cut liver fat by 67% in a clinical trial |
| 174 | 2× | 2026-08-30 01:31:01 | NASA’s Roman Space Telescope could find alien Earths—but not like you think |
| 175 | 2× | 2026-08-30 02:37:01 | Algae blooms are surfacing in the Baltic Sea |
| 176 | 2× | 2026-08-30 02:37:02 | Scientists read entire scroll from Herculaneum for the first time. Artificial intelligence helped |
| 177 | 2× | 2026-08-30 03:04:01 | I wanted to find the slowest fashion imaginable: the woman growing her own dress |
| 178 | 2× | 2026-08-30 03:31:01 | Over 10,000 endangered mountain yellow-legged frogs are taking California by storm |
| 179 | 2× | 2026-08-30 04:01:01 | A cat that is both alive and dead? How quantum physics continues to amaze even scientists |
| 180 | 2× | 2026-08-30 04:37:01 | Deep sleep brain waves offer protection against Alzheimer’s, shows new research |
| 181 | 2× | 2026-08-30 05:03:01 | Whales hold massive feasts off the east coast of Greenland: what's going on? |
| 182 | 2× | 2026-08-30 18:38:01 | Scientists propose a new method of cement production |
| 183 | 2× | 2026-08-30 19:08:01 | Scientists create the littlest big bang to study the universe's origins |
| 184 | 2× | 2026-08-30 19:35:02 | Kerala sisters pool money, use mother’s ancestral land to build a home that stays cool without AC |
| 185 | 2× | 2026-08-30 20:04:01 | Statins can reduce dementia risk by up to 15%, long-term study suggests |
| 186 | 2× | 2026-08-30 23:02:01 | We're really starting to scrape the surface of the bottom |
| 187 | 2× | 2026-08-30 23:34:01 | A walloon institute to shape our food of tomorrow |
| 188 | 2× | 2026-08-31 00:04:01 | How does your name taste? The strange science of synaesthesia |
| 189 | 2× | 2026-08-31 00:31:01 | Common supplements rival antibiotics for severe gum disease |
| 190 | 2× | 2026-08-31 01:02:01 | 1.4-million-year-old footprints reveal a surprisingly large human relative |
| 191 | 2× | 2026-08-31 01:34:01 | IBM quantum computer solves classically intractable problem in 15 minutes |
| 192 | 2× | 2026-08-31 02:06:01 | This strange “spacetime crystal” can suddenly become a black hole |
| 193 | 2× | 2026-08-31 02:38:01 | Researchers unveil sustainable spirulina solution to vitamin B12 deficiency |
| 194 | 2× | 2026-08-31 03:01:01 | HEPA air purifiers may boost brain function after just one month |
| 195 | 2× | 2026-08-31 03:31:01 | Virginia scientists discover the cues black bears use for hibernation |
| 196 | 2× | 2026-08-31 14:36:01 | Excavation work leads to largest silver find from the Viking Age |
| 197 | 2× | 2026-08-31 15:03:01 | Kids in Portugal make money from plastic waste |
| 198 | 2× | 2026-08-31 15:31:01 | Breakthrough as Turkmenistan starts fixing ‘mindboggling’ methane mega-leaks |
| 199 | 2× | 2026-08-31 18:38:01 | Order from disorder: do we need a new law of physics? |
| 200 | 2× | 2026-08-31 19:01:01 | The leap second is dead. Long live the leap hour? |
| 201 | 2× | 2026-08-31 19:33:01 | Gorilla baby born in Antwerp zoo: hope for a critically endangered species |
| 202 | 2× | 2026-08-31 21:33:01 | Fossil feet may be misleading scientists about human evolution |
| 203 | 2× | 2026-08-31 22:09:01 | Scientists challenge a 70-year-old “lizard brain” myth |
| 204 | 2× | 2026-08-31 22:36:06 | A “quantum bath” puts quantum entanglement on autopilot |
| 205 | 2× | 2026-08-31 23:06:01 | Stunning percolation proof solves decades-old puzzle about phase transitions |
| 206 | 2× | 2026-08-31 23:34:01 | Dark matter experiment catches quietest neutrinos ever measured |
| 207 | 2× | 2026-09-01 00:05:01 | New Mexico's electricity prices are some of the lowest in the country. Solar is to thank |
| 208 | 2× | 2026-09-01 00:34:01 | This 220-pound sea turtle was tangled in a fishing line. The Coast Guard saved her — and the 100 eggs she was carrying |
| 209 | 2× | 2026-09-01 01:01:01 | ‘Superhuman’ AI tool spots heart disease in less than 2 seconds |
| 210 | 2× | 2026-09-01 01:36:01 | Snake embryos often coil in one direction. Now, we may know why |
| 211 | 2× | 2026-09-01 02:04:01 | In London, children’s lungs grow faster as traffic pollution falls |
| 212 | 2× | 2026-09-01 02:34:01 | Jurassic soundscape: insect sounds from 165 million years ago reconstructed |
| 213 | 2× | 2026-09-01 11:04:01 | Steps to combat dementia could free up thousands of aged care beds in future - report |
| 214 | 2× | 2026-09-01 15:01:01 | Sperm whales create bubbles while sleeping to float safely from waves |
| 215 | 2× | 2026-09-01 21:35:01 | The download: engineered microbes for crops, and OpenAI’s culture problem |
| 216 | 2× | 2026-09-01 21:46:01 | Scientists find a human-only gene that may help explain our brainpower |
| 217 | 2× | 2026-09-01 22:01:01 | Goodbye CPAP? New sleep apnea pill cuts breathing events by 44% |
| 218 | 2× | 2026-09-01 22:18:01 | A massive plume deep beneath Africa is pulling the continent apart |
| 219 | 2× | 2026-09-01 22:39:59 | Mindfulness may lower blood pressure in just 8 weeks |
| 220 | 2× | 2026-09-01 22:47:01 | Have we finally found dark matter? |
| 221 | 2× | 2026-09-01 23:09:01 | 13 young people sued Hawaii over climate change. Here's what happened next |
| 222 | 2× | 2026-09-01 23:21:01 | China has more solar power than coal |
| 223 | 2× | 2026-09-01 23:31:01 | Tofu tops the list, cheddar at the bottom: new ranking of 20 protein sources |
| 224 | 2× | 2026-09-01 23:50:01 | Could humans ever communicate with whales? |
| 225 | 2× | 2026-09-02 00:06:01 | Flying taxis enter an industrial truth phase after ten years of extravagant promises |
| 226 | 2× | 2026-09-02 00:22:01 | Mutating every DNA letter of a genome shows surprising effects — and the limits of AI |
| 227 | 2× | 2026-09-02 00:34:01 | In 1967, 2 million Swedes started driving on the other side of the road |
| 228 | 2× | 2026-09-02 00:48:01 | WHO declares Uganda Ebola-free after 42 days without new cases |
| 229 | 2× | 2026-09-02 01:01:01 | How a girl inspired by the moon landing became ISRO’s first woman satellite project director |
| 230 | 2× | 2026-09-02 01:16:01 | How coconuts cross oceans: the natural design that lets them travel thousands of kilometres |
| 231 | 2× | 2026-09-02 01:32:01 | How engineered microbes could help feed the world’s crops |
| 232 | 2× | 2026-09-02 01:48:01 | India has an ambitious plan to lure scientists back — will its plan work? |
| 233 | 2× | 2026-09-02 02:06:01 | China’s regulatory innovation for new biomedical technologies |
| 234 | 2× | 2026-09-02 02:18:01 | Scientists identify early signal of dangerous pregnancy complications |
| 235 | 2× | 2026-09-02 14:35:01 | How AI plotted an interstellar journey to Alpha Centauri |
| 236 | 2× | 2026-09-02 14:54:01 | Mathematician discovers how to fold the smallest origami doughnut |
| 237 | 2× | 2026-09-02 15:04:01 | A breathtaking new museum dedicated to whales is shaped like a breaching humpback. It will open next year in Norway |
| 238 | 2× | 2026-09-02 15:19:01 | France leads with nearly 40 percent electric cars |
| 239 | 2× | 2026-09-02 15:34:01 | Better than soap and chamois: sea sponges can clean polluted harbors |
| 240 | 2× | 2026-09-02 15:46:01 | Endangered and heaviest parrot species on the road to revival: over 300 kakapos |
| 241 | 2× | 2026-09-02 21:31:01 | The hackers protecting America’s water supply |
| 242 | 2× | 2026-09-02 21:53:01 | Newly discovered ‘demon cave fish’ hid out in Alabama military installation for 40 years |
| 243 | 2× | 2026-09-02 22:01:01 | Italians to build a bridge the world has never seen. It will break the global length record |
| 244 | 2× | 2026-09-02 22:23:01 | Shingles vaccine protects against heart failure and dementia |
| 245 | 2× | 2026-09-02 22:37:01 | When do infections lead to long COVID? Scientists close in on triggers and treatments for post-viral syndromes |
| 246 | 2× | 2026-09-03 14:39:01 | Former poachers are protecting one of Nigeria’s last rainforests |
| 247 | 2× | 2026-09-03 22:46:01 | Study finds psilocybin protects against nerve damage from chemotherapy |
| 248 | 2× | 2026-09-03 23:04:01 | This vineyard adopted a clever alternative to using pesticides: Let 1,000 ducks roam free instead |
| 249 | 2× | 2026-09-03 23:22:01 | They are 80 years old with a 50-year-old brain: the surprising commonality of 'super-agers' |
| 250 | 2× | 2026-09-03 23:36:01 | Can cells genetically engineered in the body fight autoimmune diseases? |
| 251 | 2× | 2026-09-03 23:51:01 | Can AI help solve the peer-review crisis? Here are its promises and pitfalls |
| 252 | 2× | 2026-09-04 00:06:01 | Wildlife researchers discover tigers doing something we previously thought went against their very nature |
| 253 | 2× | 2026-09-04 00:22:01 | Indian home stays cool without A/C through clever clay architecture |
| 254 | 2× | 2026-09-04 00:35:01 | The science behind baby smell and buried underwear: these are the funniest winners of the satirical sister of the Nobel Prize |
| 255 | 2× | 2026-09-04 00:47:01 | Tamil Nadu's 70-YO palmyra tree climbers find new income through a professor's tourism trails |
| 256 | 2× | 2026-09-04 01:08:02 | The spacecraft BepiColombo is finally nearing Mercury after 8 years in space |
| 257 | 2× | 2026-09-04 01:24:01 | How Gloria Steinem helped shape feminism and gender equality |
| 258 | 2× | 2026-09-04 01:37:01 | Brain can heal itself. Polymer nano-gel reverses dementia symptoms |
| 259 | 2× | 2026-09-04 01:54:01 | The most detailed brain wiring diagram yet: How 166,000 neurons govern the fruit fly’s behavior |
| 260 | 2× | 2026-09-04 02:21:01 | Katmai brown bear cubs learning how to ‘walk on water’ to nab salmon |
| 261 | 2× | 2026-09-04 02:21:02 | High school students spot two spiral galaxies colliding in Hawaiian constellation |
| 262 | 2× | 2026-09-04 02:39:01 | 3 million oysters eaten by New Yorkers are rebuilding the city’s reefs |
| 263 | 2× | 2026-09-04 02:51:01 | Survey finds blackbirds to have the most beautiful songs in the avian world–science explains why |
| 264 | 2× | 2026-09-04 03:02:01 | Cabinet allocates 1.3 billion for crucial CO2 storage project Aramis |
| 265 | 2× | 2026-09-04 03:23:01 | Can animals sense disasters before we do? What science says about an old Indian belief |
| 266 | 2× | 2026-09-04 03:34:01 | What makes a city safe for women? 6 lessons from India’s safest cities |
| 267 | 2× | 2026-09-04 03:50:01 | An endangered pygmy raccoon turned trash into toys—and taught her family how, too |
| 268 | 2× | 2026-09-04 04:08:01 | Is it even possible to understand quantum mechanics? |
| 269 | 2× | 2026-09-04 10:34:01 | Climate scientists swap American universities for Belgium: “It’s almost impossible to hire researchers there” |
| 270 | 2× | 2026-09-04 11:02:01 | Teen invents award-winning device that can catch elephant poachers in real time |
| 271 | 2× | 2026-09-04 11:32:01 | Fossilized tissue reveals largest known T. rex died from broken rib |
| 272 | 2× | 2026-09-04 14:34:25 | This Mumbai boy has been composting since he was 2, and learning how nature works |
| 273 | 2× | 2026-09-04 14:34:26 | Indigo was once forced on Indian farmers. Here is how it changed the course of India’s freedom struggle |
| 274 | 2× | 2026-09-04 14:39:01 | Significant developments in China |
| 275 | 2× | 2026-09-04 15:03:01 | Novo Nordisk Foundation aims to build a quantum factory in Copenhagen |
| 276 | 2× | 2026-09-04 15:33:01 | Reducing fossil fuel subsidies: good for the climate, good for the budget |
| 277 | 2× | 2026-09-04 21:38:01 | Why dogs tilt their heads, according to science |
| 278 | 2× | 2026-09-04 21:47:01 | Ancient American cheetahs were not exactly cheetah-like |
| 279 | 2× | 2026-09-04 22:01:01 | A boat ride through a forest? The new ways locals are earning while protecting India’s mangroves |
| 280 | 2× | 2026-09-04 22:22:01 | This star has the strangest sky in the galaxy |
| 281 | 2× | 2026-09-04 22:32:01 | What the heck? Another perfect geometric shape has been detected on Saturn |
| 282 | 2× | 2026-09-04 22:46:00 | Japan is launching a probe to collect the first-ever samples from a Martian moon |
| 283 | 2× | 2026-09-04 23:05:01 | How a secret orangutan breeding program is creating a baby boom |
| 284 | 2× | 2026-09-04 23:19:01 | Super-precise optical clocks in four nations tick in harmony |
| 285 | 2× | 2026-09-04 23:32:01 | After 30 years of estranged trains, Sweden and Finland re-connect their railway lines |
| 286 | 2× | 2026-09-04 23:49:01 | 4 Flemish breast clinics test AI system that predicts which cancer treatment is most suitable for which patient |
| 287 | 2× | 2026-09-05 00:07:01 | How a wondrous forest has survived in the heart of Latin America’s largest city |
| 288 | 2× | 2026-09-05 00:17:01 | World first in UZ Leuven: surgeons repair severe injuries without lifelong medication afterwards |
| 289 | 2× | 2026-09-05 10:35:01 | Massive herbarium merger rescues century-old plant collection |
| 290 | 2× | 2026-09-05 10:54:01 | UN votes for a fairer world map that accurately represents Africa |
| 291 | 2× | 2026-09-05 11:05:01 | Former bird hunters work to rebuild a songbird haven: 'We hope it's not too late' |
| 292 | 2× | 2026-09-05 11:23:01 | 33-year-old former child prodigy is working on problems Hawking and Einstein never cracked |
| 293 | 2× | 2026-09-05 11:34:01 | Loza Maléombho is building an industry from African stories |
| 294 | 2× | 2026-09-05 11:47:01 | Tourists put these sea turtle nests at risk. Local Mexicans intervened, and now 3,200 hatchlings are swimming free |
| 295 | 2× | 2026-09-05 12:02:01 | 7 billion zł for a groundbreaking project. Poland will gain a huge 'water battery' |
| 296 | 2× | 2026-09-05 12:20:01 | Are these killer whales out for revenge on humans—or just trying to play? |
| 297 | 2× | 2026-09-05 12:31:01 | Tropical cyclones could be predicted with an extra day’s warning, thanks to an AI model |
| 298 | 2× | 2026-09-05 12:49:01 | Endangered salmon return to california rivers in incredible numbers: ‘everybody’s just ecstatic’ |
| 299 | 2× | 2026-09-05 13:03:01 | As a symbol of feminism, Gloria Steinem changed America |
| 300 | 2× | 2026-09-05 18:34:01 | Mathematicians discover the worst way to hang a painting |
| 301 | 2× | 2026-09-05 19:01:01 | New brain scan tool could help treat Huntington’s disease |
| 302 | 2× | 2026-09-05 22:39:09 | Fuel costs for gasoline cars now three times higher than electric charging |
| 303 | 2× | 2026-09-05 23:08:01 | Future of the economy: good news that no one sees |
| 304 | 2× | 2026-09-05 23:37:01 | Mobilizing walloon forest owners against climate change |
| 305 | 2× | 2026-09-06 00:02:01 | The centuries-old problem of mapping the world |
| 306 | 2× | 2026-09-06 10:39:01 | BMI can be misleading. Doctors point to a simple measurement that says much more |
| 307 | 2× | 2026-09-06 11:09:01 | One simple word makes children 30 percent more likely to cooperate. It works on adults, too. |
| 308 | 2× | 2026-09-06 11:37:01 | Red sea coral dying from heat stress is being revived with probiotics |
| 309 | 2× | 2026-09-07 18:50:01 | TAS in Charleroi makes the ‘electric heart’ of satellites and belongs to the world top: “Musk has turned space travel upside down” |
| 310 | 2× | 2026-09-07 19:04:01 | 500+ tonnes of waste removed: how these volunteers clean Himachal’s Himalayan trails |
| 311 | 2× | 2026-09-07 19:21:01 | Let your mind wander, don’t retire and stop worrying: surprising ways to help save your brain from the cognitive cliff |
| 312 | 2× | 2026-09-07 19:36:01 | Europe has its first commercial orbital rocket |
| 313 | 2× | 2026-09-07 19:48:01 | Astronomers create gallery of 16 ‘cosmic gems’ to show variety of shapes a galaxy can be |
| 314 | 2× | 2026-09-07 20:01:01 | Music was just saved from a copyright apocalypse by a American judge |
| 315 | 2× | 2026-09-07 20:21:01 | Old office buildings in Basel get new life as housing |
| 316 | 2× | 2026-09-07 20:34:01 | Australia’s humpback whales were acting weird. What happened next surprised scientists. |
| 317 | 2× | 2026-09-07 21:31:01 | These smart bricks know what object they make up |
| 318 | 2× | 2026-09-07 22:09:01 | These cyborg cockroaches could save your life |
| 319 | 2× | 2026-09-07 22:31:01 | Western Australia prepares for the future after the announced closure of public coal plants |
| 320 | 2× | 2026-09-07 23:07:01 | DIY plug-in solar gains momentum in the US |
| 321 | 2× | 2026-09-07 23:33:01 | 11 vibrant deep-sea creatures shine in new Caribbean expedition |
| 322 | 2× | 2026-09-08 00:05:01 | 5 Indian rice varieties that can take on extreme rainfall |
| 323 | 2× | 2026-09-08 00:31:01 | Scientists find a weak spot in one of the deadliest brain cancers |
| 324 | 2× | 2026-09-08 01:06:01 | Britain’s yellowstone: restoration project aims to take the greed out of land acquisition |
| 325 | 2× | 2026-09-08 01:37:01 | NIT Rourkela researchers turn coal waste into material that could build stronger roads |
| 326 | 2× | 2026-09-08 02:06:01 | This group has given domestic violence survivors cash with no strings attached for 10 years. It's working |
| 327 | 2× | 2026-09-08 02:38:01 | What do asthma, COPD, and dementia have to do with climate change? Quite a lot |
| 328 | 2× | 2026-09-08 03:03:01 | Nearly 500 animals rescued from trafficking arrive at a California aquarium |
| 329 | 2× | 2026-09-08 03:38:01 | Firm buys Texas coal plant to leverage its grid connections for new massive solar project |
| 330 | 2× | 2026-09-08 11:02:01 | This is dangerous: slime moulds and the bitter debate over the nature of intelligence |
| 331 | 2× | 2026-09-08 11:35:01 | So big and so close: going on a bear hunt in northern Spain |

---

## Separately: 4 duplicate pages actually live on the site

These are a different failure — the same source article published twice under two different slugs,
weeks apart, so nothing overwrote anything. Not caused by the concurrency bug. Delete one file from
each pair (keep the earlier one unless the later summary reads better) and remove the matching
`articles` row.

| Source article | Files |
|----------------|-------|
| gva.be — astronaut pumps breast milk in space | `2026-06-05-astronaut-pumps-breast-milk-in-space-as-first-woman-once-the.md`<br>`2026-06-24-astronaut-pumps-breast-milk-in-space-as-first-woman-they-onc.md` |
| vrtnws.be/p.dLeN5NpOV — hero who saved Octavie (92) | `2026-06-05-hero-who-saved-octavie-92-from-fire-in-opwijk-celebrated-dur.md`<br>`2026-06-24-hero-who-saved-octavie-92-from-fire-in-opwijk-celebrated-dur.md` |
| vrtnws.be/p.BlN0nX3JW — Friesland WWI refugees | `2026-06-05-friesland-commemorates-belgian-refugees-of-world-war-i-with.md`<br>`2026-06-24-friesland-remembers-belgian-refugees-of-world-war-i-with-pea.md` |
| vrtnws.be/p.0YJAKkqbZ — clover and herbs cool orchards | `2026-08-14-clover-and-herbs-keep-fruit-orchards-up-to-20-degrees-cooler.md`<br>`2026-08-14-clover-and-herbs-keep-fruit-plantations-up-to-20-degrees-coo.md` |

Note the 19-day gap on the first three: the new in-pipeline dedup uses a 14-day window
(`DEDUP_WINDOW_DAYS`), so it would still miss those. It does catch the 4th (same day). Widen the
window if this class matters more than the extra comparisons.
