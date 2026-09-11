---
title: "When zero is the lie"
title_nl: "Wanneer nul de leugen is"
title_fr: "Quand zéro est le mensonge"
date: 2026-09-11T10:22:03
emoji: "✍️"
summary: "I recently explored how some charts can mislead by cutting off the bottom of the axis, which can distort the truth. The PISA article in De Standaard caught my attention, especially its alarming portrayal of Flanders' educational performance. It turns out that while some charts were accurate, others manipulated perceptions by not starting at zero. This raises important questions about how we interpret data and the responsibility of media to present it honestly."
summary_nl: "Onlangs heb ik onderzocht hoe sommige grafieken kunnen misleiden door de onderkant van de as af te snijden, wat de waarheid kan verdraaien. Het PISA-artikel in De Standaard trok mijn aandacht, vooral de alarmerende weergave van de onderwijsprestaties in Vlaanderen. Het blijkt dat hoewel sommige grafieken nauwkeurig waren, andere de perceptie manipuleerden door niet bij nul te beginnen. Dit roept belangrijke vragen op over hoe we gegevens interpreteren en de verantwoordelijkheid van de media om deze eerlijk te presenteren."
summary_fr: "Récemment, j'ai exploré comment certains graphiques peuvent induire en erreur en coupant le bas de l'axe, ce qui peut déformer la vérité. L'article PISA dans De Standaard a attiré mon attention, notamment sa représentation alarmante des performances éducatives en Flandre. Il s'avère que, bien que certains graphiques soient précis, d'autres manipulent les perceptions en ne commençant pas à zéro. Cela soulève des questions importantes sur la façon dont nous interprétons les données et la responsabilité des médias de les présenter honnêtement."
image_url: "/assets/editorials/when-zero-is-the-lie.jpg"
content_nl: |
  # Wanneer nul de leugen is
  
  Vorige week ging ik door een kleine galerij van grafieken die de onderkant van de as afsnijden om een hobbel in een klif te veranderen. Ik gaf ook toe wat het triggerde: het [PISA-artikel in De Standaard](https://www.standaard.be/binnenland/leesniveau-van-vlaamse-jongeren-is-dramatisch-pisa-resultaten-boeren-opnieuw-sterk-achteruit/161100986.html) van 8 september, met zijn "dramatische" kop en zijn lijngrafieken die van 450 tot 550 lopen. Ik was, eerlijk gezegd, klaar om een stuk te schrijven over hoe onze kranten overdrijven om klikken te verkopen.
  
  Dus deed ik wat ik altijd tegen mensen zeg. Ik controleerde.
  
  ## Wat hebben ze eigenlijk gedaan?
  
  Het artikel heeft vijf grafieken. Drie daarvan tonen percentages - het aandeel van top- en laagpresteerders in lezen, wiskunde en wetenschap, en het aandeel studenten die het basisleesniveau niet bereiken, gesplitst naar thuistaal. Alle drie beginnen bij nul. Geen trucs.
  
  De twee grafieken die ik had opgemerkt, zijn degene die de gemiddelde PISA-score voor Vlaanderen versus Europa tonen, van 2003 tot 2025. Die lopen van 450 tot 550. En hier moest ik stoppen en nadenken, want de vraag is niet "begint de as bij nul". De vraag is "heeft nul hier enige betekenis".
  
  ## De schaal waar niemand ooit nul op heeft gescoord
  
  Een PISA-score is geen telling van iets. Het is een schaal die de OESO heeft gekalibreerd zodat het gemiddelde over OESO-landen bij de eerste meting 500 was, met een standaardafwijking van 100. Niemand scoort nul. Niemand scoort 1000. In de praktijk leeft het geheel tussen ongeveer 350 en 600. De vuistregel van de OESO, die De Standaard citeert, is dat ongeveer 20 punten gelijkstaat aan één jaar school.
  
  Kijk nu naar de cijfers, die ik heb gehaald uit het [Vlaams Indicatorenboek](https://www.vlaamsindicatorenboek.be/6.2.4) en het [UGent PISA 2025-rapport](https://www.pisa.ugent.be/resultaten/pisa-2025/vlaamse-resultaten). Lezen in Vlaanderen ging van 530 in 2003 naar 467 in 2025. Wiskunde ging van 553 naar 489. Dat is 63 en 64 punten. Volgens de vuistregel van de OESO is dat ongeveer drie schooljaren (sommige Vlaamse academici gebruiken een zorgvuldiger conversie en komen uit op "ten minste anderhalf jaar", wat nog steeds veel is). Twee derde van een standaardafwijking. Onze 15-jarigen gingen van ver boven de oorspronkelijke 500-norm naar ver daaronder, en zien er vandaag alleen "boven gemiddeld" uit omdat de meeste andere landen ook zijn gedaald.
  
  Dat is wat de afbeelding bovenaan dit artikel laat zien. Links de gegevens zoals De Standaard ze heeft getekend. Rechts dezelfde gegevens op de "eerlijk" as van nul - de as die ik ging eisen. En op die eerlijke as is de daling een nauwelijks zichtbare helling. Drie verloren jaren school, afgevlakt tot een lijn die zegt "hier is niets te zien". *Die* grafiek zou de leugen zijn geweest.
  
  ## Dus wat is de werkelijke regel?
  
  Dit bleek een echte konijnenhol te zijn, en de mensen die professioneel over grafieken nadenken, zijn opmerkelijk consistent hierover.
  
  Balken moeten beginnen bij nul. Altijd. Een balk codeert een waarde in zijn lengte, dus een balk die begint bij 28 is gewoon de verkeerde lengte aan het tekenen. Datawrapper, de tool die de helft van de nieuwsredacties ter wereld gebruikt, [weigerde je dat te laten doen](https://www.datawrapper.de/academy/why-our-column-and-bar-charts-start-at-zero). De ergste overtreders van vorige week - NOS, Fox, VRT, de N-VA-grafiek - waren allemaal staafgrafieken, of hadden helemaal geen as.
  
  Lijnen en stippen hoeven dat niet. Een lijn codeert verandering in zijn helling, niet in zijn afstand van de vloer. Statisticus Andrew Gelman verwoordt het mooi: [als nul in de buurt is, nodig het uit](https://statmodeling.stat.columbia.edu/2021/12/17/graphing-advice-if-zero-is-in-the-neighborhood-invite-it-in/) - en als het dat niet is, sleep het dan niet naar binnen alleen maar om deugdzaam te lijken. Kaiser Fung van Junk Charts [zegt hetzelfde](https://junkcharts.typepad.com/junk_charts/2022/01/start-at-zero-or-start-at-wherever.html), en zijn voorbeeld zijn SAT-scores, wat zo dicht bij PISA komt als je maar kunt krijgen: niemand scoort nul, dus nul vertelt je niets.
  
  En zeg wat je deed. Een lijngrafiek met een afgesneden as is prima wanneer de as zichtbaar en gelabeld is, en de lezer het referentiepunt kan zien. De Standaard tekende een stippellijn op 500 en labelde deze als het OESO-gemiddelde bij de eerste meting. Dat is precies wat je zou moeten doen.
  
  Sanne Willems schreef een prachtige Nederlandse uitleg voor de Nederlandse statistische vereniging die op dezelfde plaats aankomt: [moet je altijd bij het begin beginnen?](https://blog.vvsor.nl/2022/02/moet-je-altijd-bij-het-begin-beginnen/) Nee. Je moet beginnen bij een *logisch* punt, en je moet eerlijk zijn over welk punt dat is.
  
  ## Wat ik verkeerd had, en wat ik nog steeds denk
  
  Ik had de reflex verkeerd. Ik zag een afgesneden as, koppelde het aan de galerij van verschrikkingen van vorige week, en bijna schreef ik een stuk waarin ik een krant beschuldigde van manipulatie voor het goed uitvoeren van zijn werk. Dat is op zich een nuttige les. Scepticisme over grafieken is een goede gewoonte, maar scepticisme is niet hetzelfde als de regel kennen. De regel gaat over balken versus lijnen, en over of nul iets betekent - niet over nul als een magisch getal.
  
  Wat ik nog steeds denk is dat de overtreders van vorige week elke kritiek verdienen. De NOS zorgkostenbalken en de Fox News inschrijfbalken waren tellingen, getekend als balken, met de onderkant eraf gezaagd. Daar is geen verdediging voor. De De Morgen familie grafiek was een lijn, dus volgens de letter van de regel krijgt het meer speling - maar een kop over families die "vluchten" uit de stad, boven een lijn waarvan de as is gekozen om een paar honderd families eruit te laten zien als een exodus, is dezelfde zonde in een ander grafiektype. De regel is een hulpmiddel. De test is nog steeds of de afbeelding overeenkomt met de cijfers.
  
  En er is een derde groep die me meer zorgen baart dan een van die twee: lezers die, nadat ze hebben geleerd dat "de as bij nul moet beginnen", nu elke grafiek die dat niet doet, afwijzen. Dat is hoe je een publiek krijgt dat schouderophalend reageert op drie verloren jaren school omdat de lijn "niet zo steil leek". Positron gaat niet over het wantrouwen van het nieuws. Het gaat over het goed lezen ervan - en dat snijdt aan twee kanten. Soms is de eerlijke grafiek de alarmerende.
  
  Voor wat het waard is: de daling is echt, hij is groot, en het feit dat de grafiek die het toont correct is getekend, is het minste van onze problemen.
  
  Ik hoop dat dit een nuttige reflectie was - zoals altijd, zou ik graag horen wat je ervan denkt.
  
  Groeten
  
  Rik
content_fr: |
  # Quand le zéro est le mensonge
  
  La semaine dernière, j'ai parcouru une petite galerie de graphiques qui coupent le bas de l'axe pour transformer une bosse en falaise. J'ai également avoué ce qui a déclenché cela : l'[article PISA dans De Standaard](https://www.standaard.be/binnenland/leesniveau-van-vlaamse-jongeren-is-dramatisch-pisa-resultaten-boeren-opnieuw-sterk-achteruit/161100986.html) du 8 septembre, avec son titre "dramatique" et ses graphiques linéaires allant de 450 à 550. J'étais, franchement, prêt à écrire un article sur la façon dont nos journaux exagèrent pour vendre des clics.
  
  Alors j'ai fait ce que je dis toujours aux gens de faire. J'ai vérifié.
  
  ## Que ont-ils réellement fait ?
  
  L'article contient cinq graphiques. Trois d'entre eux montrent des pourcentages - la part des meilleurs et des moins bons performeurs en lecture, mathématiques et sciences, et la part des élèves qui n'atteignent pas le niveau de lecture de base, répartis par langue maternelle. Les trois commencent à zéro. Pas de trucs.
  
  Les deux graphiques que j'avais remarqués sont ceux montrant le score PISA moyen pour la Flandre par rapport à l'Europe, de 2003 à 2025. Ceux-ci vont de 450 à 550. Et ici, j'ai dû m'arrêter et réfléchir, car la question n'est pas "l'axe commence-t-il à zéro". La question est "le zéro signifie-t-il quelque chose ici".
  
  ## L'échelle sur laquelle personne n'a jamais obtenu zéro
  
  Un score PISA n'est pas un compte de quoi que ce soit. C'est une échelle que l'OCDE a calibrée de sorte que la moyenne des pays de l'OCDE lors de la première mesure était de 500, avec un écart type de 100. Personne ne marque zéro. Personne ne marque 1000. En pratique, l'ensemble vit entre environ 350 et 600. La règle empirique de l'OCDE, que De Standaard cite, est qu'environ 20 points correspondent à une année d'école.
  
  Maintenant, regardez les chiffres, que j'ai pris du [Vlaams Indicatorenboek](https://www.vlaamsindicatorenboek.be/6.2.4) et du [rapport UGent PISA 2025](https://www.pisa.ugent.be/resultaten/pisa-2025/vlaamse-resultaten). La lecture en Flandre est passée de 530 en 2003 à 467 en 2025. Les mathématiques sont passées de 553 à 489. C'est 63 et 64 points. Selon la règle empirique de l'OCDE, environ trois années scolaires (certains universitaires flamands utilisent une conversion plus prudente et arrivent à "au moins un an et demi", ce qui est encore beaucoup). Deux tiers d'un écart type. Nos adolescents de 15 ans sont passés de bien au-dessus de la référence originale de 500 à bien en dessous, et ne semblent "au-dessus de la moyenne" aujourd'hui que parce que la plupart des autres pays ont également glissé.
  
  C'est ce que montre l'image en haut de cet article. À gauche, les données telles que De Standaard les a dessinées. À droite, les mêmes données sur l'axe "honnête" à partir de zéro - celui que j'allais demander. Et sur cet axe honnête, la chute est une inclinaison à peine visible. Trois années scolaires perdues, aplaties en une ligne qui dit "rien à voir ici". *Ce* graphique aurait été le mensonge.
  
  ## Alors, quelle est la règle réelle ?
  
  Cela s'est avéré être un véritable terrier de lapin, et les personnes qui réfléchissent aux graphiques pour vivre sont remarquablement cohérentes à ce sujet.
  
  Les barres doivent commencer à zéro. Toujours. Une barre encode une valeur dans sa longueur, donc une barre qui commence à 28 dessine simplement la mauvaise longueur. Datawrapper, l'outil utilisé par la moitié des rédactions du monde, [refuse de vous laisser le faire](https://www.datawrapper.de/academy/why-our-column-and-bar-charts-start-at-zero). Les pires contrevenants de la semaine dernière - NOS, Fox, VRT, le graphique N-VA - étaient tous des graphiques à barres, ou n'avaient pas d'axe du tout.
  
  Les lignes et les points n'ont pas besoin de le faire. Une ligne encode le changement dans sa pente, pas dans sa distance du sol. Le statisticien Andrew Gelman le dit bien : [si zéro est dans le voisinage, invitez-le](https://statmodeling.stat.columbia.edu/2021/12/17/graphing-advice-if-zero-is-in-the-neighborhood-invite-it-in/) - et s'il ne l'est pas, ne le traînez pas juste pour avoir l'air vertueux. Kaiser Fung de Junk Charts [dit la même chose](https://junkcharts.typepad.com/junk_charts/2022/01/start-at-zero-or-start-at-wherever.html), et son exemple est les scores SAT, qui sont à peu près aussi proches de PISA que l'on peut l'être : personne ne marque zéro, donc zéro ne vous dit rien.
  
  Et dites ce que vous avez fait. Un graphique linéaire avec un axe coupé est acceptable lorsque l'axe est visible et étiqueté, et que le lecteur peut voir le point de référence. De Standaard a dessiné une ligne en pointillés à 500 et l'a étiquetée comme la moyenne de l'OCDE lors de la première mesure. C'est exactement ce que vous êtes censé faire.
  
  Sanne Willems a écrit un joli explicatif néerlandais pour la société statistique néerlandaise qui arrive au même endroit : [moet je altijd bij het begin beginnen?](https://blog.vvsor.nl/2022/02/moet-je-altijd-bij-het-begin-beginnen/) Non. Vous devez commencer à un point *logique*, et vous devez être honnête sur lequel.
  
  ## Ce que j'ai mal compris, et ce que je pense encore
  
  J'ai eu le mauvais réflexe. J'ai vu un axe coupé, l'ai associé à la galerie d'horreurs de la semaine dernière, et j'ai failli écrire un article accusant un journal de manipulation pour avoir fait son travail correctement. C'est une leçon utile en soi. Le scepticisme à l'égard des graphiques est une bonne habitude, mais le scepticisme n'est pas la même chose que connaître la règle. La règle concerne les barres par rapport aux lignes, et si zéro signifie quelque chose - pas sur zéro en tant que nombre magique.
  
  Ce que je pense encore, c'est que les contrevenants de la semaine dernière méritent chaque critique. Les barres de coûts de soins de la NOS et les barres d'inscription de Fox News étaient des comptes, dessinés sous forme de barres, avec le bas scié. Il n'y a aucune défense pour cela. Le graphique familial de De Morgen était une ligne, donc selon la lettre de la règle, il obtient plus de marge - mais un titre sur des familles "fuyant" la ville, sur une ligne dont l'axe a été choisi pour faire paraître quelques centaines de familles comme un exode, est le même péché dans un type de graphique différent. La règle est un outil. Le test est toujours de savoir si l'image correspond aux chiffres.
  
  Et il y a un troisième groupe qui m'inquiète plus que ceux-là : des lecteurs qui, ayant appris que "l'axe doit commencer à zéro", rejettent maintenant tout graphique qui ne le fait pas. C'est ainsi que vous obtenez un public qui hausse les épaules face à trois années scolaires perdues parce que la ligne "ne semblait pas si raide". Positron n'est pas une question de méfiance envers les nouvelles. Il s'agit de bien les lire - et cela va dans les deux sens. Parfois, le graphique honnête est celui qui est alarmant.
  
  Pour ce que ça vaut : la chute est réelle, elle est grande, et le fait que le graphique qui la montre ait été dessiné correctement est le moindre de nos problèmes.
  
  J'espère que cela a été une réflexion utile - comme toujours, j'aimerais savoir ce que vous en pensez.
  
  Cordialement
  
  Rik
layout: editorial.njk
---

# When zero is the lie

Last week I went through a small gallery of charts that cut off the bottom of the axis to turn a bump into a cliff. I also confessed what triggered it: the [PISA article in De Standaard](https://www.standaard.be/binnenland/leesniveau-van-vlaamse-jongeren-is-dramatisch-pisa-resultaten-boeren-opnieuw-sterk-achteruit/161100986.html) of 8 September, with its "dramatic" headline and its line charts running from 450 to 550. I was, frankly, ready to write a piece about how our newspapers exaggerate to sell clicks.

So I did what I always tell people to do. I checked.

## What did they actually do?

The article has five charts. Three of them show percentages - the share of top and low performers in reading, maths and science, and the share of students who don't reach the basic reading level, split by home language. All three start at zero. No tricks.

The two charts I had noticed are the ones showing the average PISA score for Flanders versus Europe, from 2003 to 2025. Those run from 450 to 550. And here I had to stop and think, because the question is not "does the axis start at zero". The question is "does zero mean anything here".

## The scale nobody has ever scored zero on

A PISA score is not a count of anything. It is a scale that the OECD calibrated so that the average across OECD countries at the first measurement was 500, with a standard deviation of 100. Nobody scores zero. Nobody scores 1000. In practice the whole thing lives between roughly 350 and 600. The OECD's own rule of thumb, which De Standaard quotes, is that about 20 points is one year of schooling.

Now look at the numbers, which I took from the [Vlaams Indicatorenboek](https://www.vlaamsindicatorenboek.be/6.2.4) and the [UGent PISA 2025 report](https://www.pisa.ugent.be/resultaten/pisa-2025/vlaamse-resultaten). Reading in Flanders went from 530 in 2003 to 467 in 2025. Maths went from 553 to 489. That is 63 and 64 points. By the OECD's rule of thumb, roughly three school years (some Flemish academics use a more careful conversion and arrive at "at least a year and a half", which is still a lot). Two thirds of a standard deviation. Our 15-year-olds went from well above the original 500 benchmark to well below it, and only look "above average" today because most other countries slid too.

That is what the picture at the top of this article shows. On the left, the data as De Standaard drew it. On the right, the same data on the "honest" axis from zero - the one I was going to demand. And on that honest axis, the drop is a barely visible tilt. Three lost years of schooling, flattened into a line that says "nothing to see here". *That* chart would have been the lie.

## So what is the actual rule?

This turned out to be a proper rabbit hole, and the people who think about charts for a living are remarkably consistent about it.

Bars must start at zero. Always. A bar encodes a value in its length, so a bar that starts at 28 is simply drawing the wrong length. Datawrapper, the tool half of the world's newsrooms use, [refuses to let you do it](https://www.datawrapper.de/academy/why-our-column-and-bar-charts-start-at-zero). The worst offenders from last week - NOS, Fox, VRT, the N-VA chart - were all bar charts, or had no axis at all.

Lines and dots don't have to. A line encodes change in its slope, not in its distance from the floor. Statistician Andrew Gelman puts it nicely: [if zero is in the neighbourhood, invite it in](https://statmodeling.stat.columbia.edu/2021/12/17/graphing-advice-if-zero-is-in-the-neighborhood-invite-it-in/) - and if it isn't, don't drag it in just to look virtuous. Kaiser Fung of Junk Charts [says the same](https://junkcharts.typepad.com/junk_charts/2022/01/start-at-zero-or-start-at-wherever.html), and his example is SAT scores, which is about as close to PISA as you can get: nobody scores zero, so zero tells you nothing.

And say what you did. A line chart with a cut axis is fine when the axis is visible and labelled, and the reader can see the reference point. De Standaard drew a dashed line at 500 and labelled it as the OECD average at the first measurement. That is exactly what you are supposed to do.

Sanne Willems wrote a lovely Dutch explainer for the Dutch statistical society that arrives at the same place: [moet je altijd bij het begin beginnen?](https://blog.vvsor.nl/2022/02/moet-je-altijd-bij-het-begin-beginnen/) No. You have to begin at a *logical* point, and you have to be honest about which one.

## What I got wrong, and what I still think

I got the reflex wrong. I saw a cut axis, matched it to last week's gallery of horrors, and nearly wrote a piece accusing a newspaper of manipulation for doing its job properly. That's a useful lesson in itself. Scepticism about charts is a good habit, but scepticism is not the same as knowing the rule. The rule is about bars versus lines, and about whether zero means something - not about zero as a magic number.

What I still think is that last week's offenders deserve every bit of the criticism. The NOS care-cost bars and the Fox News enrolment bars were counts, drawn as bars, with the bottom sawn off. There is no defence for that. The De Morgen family chart was a line, so by the letter of the rule it gets more slack - but a headline about families "fleeing" the city, over a line whose axis was picked to make a few hundred families look like an exodus, is the same sin in a different chart type. The rule is a tool. The test is still whether the picture matches the numbers.

And there is a third group that worries me more than either of those: readers who, having learned that "the axis should start at zero", now dismiss any chart that doesn't. That is how you get a public that shrugs at three lost years of schooling because the line "didn't look that steep". Positron is not about distrusting the news. It is about reading it well - and that cuts both ways. Sometimes the honest chart is the alarming one.

For what it's worth: the drop is real, it's big, and the fact that the chart showing it was drawn correctly is the least of our problems.

Hope this was a useful reflection - as always, would love to hear what you think.

Cheers

Rik
