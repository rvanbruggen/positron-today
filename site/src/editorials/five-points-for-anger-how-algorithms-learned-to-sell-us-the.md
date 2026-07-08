---
title: "Five points for anger: how algorithms learned to sell us the worst of each other"
title_nl: "Vijf punten voor woede: hoe algoritmes ons het slechtste van elkaar leren verkopen"
title_fr: "Cinq points pour la colère : comment les algorithmes ont appris à nous vendre le pire de nous-mêmes"
date: 2026-07-08T05:54:03
emoji: "✍️"
summary: "I've been reflecting on how algorithms amplify our negativity bias, especially on social media. Studies show that negative content spreads faster and gets more engagement, which is quite alarming. Facebook's decision to weight angry reactions more heavily than likes is a prime example of this. It’s fascinating and a bit scary to see how our online interactions can be shaped by these mechanisms."
summary_nl: "Ik heb nagedacht over hoe algoritmes onze negativiteitsbias versterken, vooral op sociale media. Studies tonen aan dat negatieve inhoud sneller verspreidt en meer betrokkenheid krijgt, wat behoorlijk verontrustend is. Facebook's beslissing om boze reacties zwaarder te wegen dan 'likes' is een goed voorbeeld hiervan. Het is fascinerend en een beetje eng om te zien hoe onze online interacties door deze mechanismen kunnen worden gevormd."
summary_fr: "J'ai réfléchi à la façon dont les algorithmes amplifient notre biais de négativité, surtout sur les réseaux sociaux. Des études montrent que le contenu négatif se propage plus rapidement et obtient plus d'engagement, ce qui est assez alarmant. La décision de Facebook de pondérer les réactions en colère plus lourdement que les 'j'aime' en est un exemple frappant. C'est fascinant et un peu effrayant de voir comment nos interactions en ligne peuvent être façonnées par ces mécanismes."
image_url: "/assets/editorials/what-spreads.svg"
content_nl: |
  # Vijf punten voor woede: hoe algoritmes ons het slechtste van elkaar leerden verkopen
  
  ![Een vergelijking van twee sociale media-reactieknoppen: een like die één punt waard is naast een boze reactie die vijf punten waard is](/assets/editorials/five-points-for-anger.svg)
  
  Laat me beginnen met iets dat ik heb opgemerkt over mijn eigen gedrag, omdat het een beetje gênant is en ik vermoed dat ik niet de enige ben. Wanneer ik iets op LinkedIn plaats - een leuk project, een beetje oprechte enthousiasme over een technologie waar ik van hou - gaat het prima. Beleefd prima. Maar af en toe zie ik iemand iets spiky plaatsen, een klacht, een beetje verontwaardiging, een "kun je dit geloven?" - en het stijgt als een raket. Meer reacties, meer shares, meer hitte, in één middag dan mijn zonnige kleine berichten in een week krijgen.
  
  Lange tijd heb ik dat onder "mensen zijn gewoon zo" geclassificeerd. En dat zijn ze - we hebben de afgelopen drie artikelen precies vastgesteld *hoe* ze zijn, door de evolutie geprogrammeerd om naar het negatieve te leunen. Maar er is een nieuwere, scherpere kant van het verhaal die ik oprecht wil begrijpen, en het is het enige dat me deed verlangen naar het bouwen van [Positron](https://positron.today/) meer dan wat dan ook. Want onze oude menselijke negativiteitsbias is één ding. Wat gebeurt er als je die bias aan een machine geeft wiens hele taak het is om jouw aandacht te maximaliseren - dat is iets heel anders.
  
  Dus dit is het artikel over de machines.
  
  ## Ten eerste, de machines geven echt de voorkeur aan slecht nieuws
  
  Laten we het basisfeit vaststellen voordat we naar het hoe en waarom gaan, want het is prachtig gemeten.
  
  In 2023 publiceerde een team onder leiding van Claire Robertson een studie in Nature Human Behaviour met de prachtig directe titel ["Negativity drives online news consumption"](https://www.nature.com/articles/s41562-023-01538-4). Ze hadden toegang tot iets dat dicht bij de droom van een onderzoeker ligt: gegevens van Upworthy, dat jarenlang eindeloze A/B-tests uitvoerde op zijn eigen koppen - hetzelfde verhaal, andere woorden, getoond aan echte mensen. Ongeveer 105.000 kopvariaties. Iets van 5,7 miljoen klikken. Echt gedrag, op enorme schaal.
  
  De bevinding was helder en een beetje verontrustend. Voor een kop van gemiddelde lengte verhoogde elk extra *negatief* woord de doorklikratio met ongeveer 2,3%. En positieve woorden deden het tegenovergestelde - ze duwden klikken *omlaag*. Het verrassende is dat positieve woorden eigenlijk iets vaker voorkwamen. Het is niet zo dat de wereld alleen maar slechte koppen biedt. Het zijn de slechte die keer op keer de klik winnen, op een manier die je tot op de decimalen kunt meten.
  
  Dat is het ruwe materiaal. Kijk nu wat er gebeurt wanneer een algoritme het in handen krijgt.
  
  ## Wat zich daadwerkelijk verspreidt
  
  Twee andere studies, naar mijn mening, maken dit duidelijk.
  
  ![Drie onderzoeksbevindingen over wat online verspreidt: negatieve woorden verhogen klikken met twee komma drie procent, moreel-emotionele woorden verhogen shares met twintig procent, en berichten die politieke tegenstanders aanvallen zijn de enige sterkste drijfveer voor delen](/assets/editorials/what-spreads.svg)
  
  De eerste is van William Brady, Jay Van Bavel en collega's, in 2017, en het introduceerde een zin die ik nu de hele tijd gebruik: ["morele besmetting"](https://www.pnas.org/doi/10.1073/pnas.1618923114). Ze keken naar meer dan een half miljoen tweets over hete moreel-politieke onderwerpen - wapenbeheersing, huwelijk tussen personen van hetzelfde geslacht, klimaatverandering - en ontdekten dat elk extra *moreel-emotioneel* woord in een bericht (woorden als "aanval", "schaamte", "hebzucht", "kwaad") de reikwijdte met ongeveer 20% verhoogde. Maar hier is de wending die ertoe doet: die verspreiding gebeurde voornamelijk *binnen* ideologische groepen, niet eroverheen. Verontwaardiging reisde snel, maar het reisde in cirkels - het verdiept de kloof in plaats van deze te overbruggen.
  
  De tweede studie gaat een stap verder, en het is degene die echt bij me binnenkomt. In 2021 keken Steve Rathje, Van Bavel en Sander van der Linden naar 2,7 miljoen berichten van nieuwsmedia en politici en stelden een eenvoudige vraag: welke inhoud verspreidt zich het verst? Het antwoord was geen vreugde. Het was zelfs geen trots of lof voor de eigen groep. De enige sterkste voorspeller dat een bericht werd gedeeld was ["animositeit tegen de andere groep"](https://www.pnas.org/doi/10.1073/pnas.2024292118) - berichten *over de andere kant*, de mensen met wie je het niet eens bent. Praten over je politieke tegenstanders overtrof elke andere factor die ze maten, inclusief eenvoudige emotionele taal. Niets verspreidt zich zoals minachting voor "hen."
  
  Neem daar even de tijd voor. Het meest deelbare dat online is, is niet iets goeds. Het is zelfs niet iets treurigs. Het is woede tegen de andere groep. Dat is de vorm van de ruwe vraag - en de algoritmes gingen op zoek naar precies die vorm.
  
  ## Het rookwapen: vijf punten voor woede
  
  Hier stopt het abstract te zijn, want voor eens hoeven we niet te raden waar een platform voor optimaliseerde. We hebben de documenten.
  
  In 2021 bracht de klokkenluider Frances Haugen een schat aan intern Facebook-materiaal naar buiten, en onder de dingen die gerapporteerd werden door de [Washington Post](https://www.washingtonpost.com/technology/2021/10/26/facebook-angry-emoji-algorithm/) was een klein, onthullend detail over hoe de nieuwsfeed werd gerangschikt. Toen Facebook die emoji-reacties introduceerde - liefde, haha, wauw, verdrietig, boos - besloot het, beginnend in 2017, om elke emoji-reactie te behandelen als *vijf keer* meer waard dan een bescheiden "like" in zijn rangschikking algoritme. Vijf punten voor een reactie, één voor een like.
  
  Denk na over wat dat stilletjes doet. Een "like" is wat je geeft aan iets leuks. Maar je tikt niet op "boos" bij een puppyfoto - je tikt het op het ding dat je verontwaardigt. Door reacties vijf keer zwaarder te wegen, draaide Facebook in feite het volume omhoog op precies de inhoud die het meest waarschijnlijk mensen woedend maakt. En hun eigen gegevens, een paar jaar later, bevestigden het voor de hand liggende: berichten die veel boze reacties kregen, waren onevenredig waarschijnlijk om desinformatie, toxiciteit en nieuws van lage kwaliteit te bevatten. Medewerkers hadden het risico vanaf het begin gemarkeerd. Het bedrijf heeft het uiteindelijk teruggedraaid - de weging verlaagd, vervolgens berichten gedegradeerd die onevenredig veel woede opriepen, en in 2020 de waarde van de boze reactie helemaal naar nul verlaagd.
  
  Maar jarenlang draaide de machine op volle toeren. Het was niet bedoeld om de wereld bozer te maken. Het was bedoeld om betrokkenheid te maximaliseren - en het blijkt dat die twee dingen, verontrustend genoeg, bijna hetzelfde zijn.
  
  ## Laat me eerlijk zijn hierover
  
  Nu, ik had mezelf beloofd toen ik begon met schrijven dat ik niet te veel zou claimen, dus laat me enkele eerlijke kanttekeningen op tafel leggen.
  
  Ten eerste, het meeste hiervan is correlatie, en correlatie is glad. Tonen dat boze, negatieve, inhoud van de andere groep verder verspreidt, is niet hetzelfde als bewijzen dat het algoritme *ons* bozer maakte. Een deel ervan is zeker gewoon het algoritme dat een spiegel voorhoudt van wat we al zochten - de negativiteitsbias van de eerdere artikelen, nu simpelweg teruggekaatst met industriële snelheid. Het ontrafelen van "de machine maakte ons zo" van "de machine gaf ons meer van wat we al leuk vonden" is oprecht moeilijk, en serieuze onderzoekers discussiëren nog steeds over de balans.
  
  Ten tweede, wetenschap corrigeert zichzelf, en sommige van deze effecten lijken kleiner of meer voorwaardelijk onder replicatie dan de opvallende kopcijfers suggereren. De richting van de bevindingen is robuust en herhaald. De exacte grootten verdienen bescheidenheid.
  
  Maar zelfs met al die kanttekeningen is de vorm van de zaak duidelijk genoeg. Onze hersenen leunen negatief. De inhoud die zich verspreidt is negatief, gemoraliseerd en gericht op "de andere kant." En de platforms, die achter betrokkenheid aanjagen, bouwden machines die - opzettelijk of niet - precies dat versterkten. Menselijke bias ging aan de ene kant naar binnen; een verontwaardigingsmachine kwam aan de andere kant eruit.
  
  ## Wat de hele reden is voor het tegenovergestelde
  
  En dit, ten slotte, is waarom Positron is gebouwd zoals het is - en waarom de "hoe het werkt" pagina misschien wel het belangrijkste is op de site.
  
  Er is geen algoritme op Positron dat optimaliseert voor jouw betrokkenheid, omdat er niets is om *voor* te optimaliseren. Geen advertenties. Geen feedrangschikking. Geen reactieknoppen die stilletjes jouw woede scoren. Het verdient geen cent of je kalm of woedend bent, dus het heeft geen reden om naar het ding te reiken dat je woedend maakt. Het is, met opzet, het exacte tegenovergestelde van de verontwaardigingsmachine: een klein, opzettelijk niet-geoptimaliseerd hoekje van het internet waar het enige dat het nieuws sorteert is "is dit eigenlijk goed?"
  
  Dat zal de machines niet repareren. Ik ben één Belg met een website; ik heb geen illusies. Maar het kan een plek zijn om te staan die niet binnen de machine is - en eerlijk gezegd, sommige dagen voelt dat als genoeg.
  
  In het laatste artikel van deze serie wil ik kijken naar wat dit alles - de bias, de vrees, de verontwaardigingsmachine - daadwerkelijk met ons doet. Want het blijkt dat het onderzoek daarover behoorlijk schokkend is, en het onderzoek naar wat een beter nieuwsdieet in plaats daarvan kan doen, is oprecht hoopvol.
  
  Proost / Rik
content_fr: |
  # Cinq points pour la colère : comment les algorithmes ont appris à nous vendre le pire de nous-mêmes
  
  ![Une comparaison de deux boutons de réaction sur les réseaux sociaux : un "j'aime" valant un point à côté d'une réaction de colère valant cinq points](/assets/editorials/five-points-for-anger.svg)
  
  Permettez-moi de commencer par quelque chose que j'ai remarqué sur mon propre comportement, car c'est un peu embarrassant et je soupçonne que je ne suis pas seul. Quand je publie quelque chose sur LinkedIn - un joli projet, un peu d'enthousiasme sincère pour une technologie que j'adore - cela fonctionne bien. Poliment bien. Mais de temps en temps, j'ai vu quelqu'un publier quelque chose de piquant, une plainte, un peu d'indignation, un "pouvez-vous croire ça ?" - et ça décolle comme une fusée. Plus de commentaires, plus de partages, plus de chaleur, en un après-midi que mes petits posts ensoleillés n'en obtiennent en une semaine.
  
  Pendant longtemps, j'ai classé cela sous "les gens sont comme ça." Et ils le sont - nous avons passé les trois derniers articles à établir exactement *comment* ils le sont, câblés par l'évolution pour pencher vers le négatif. Mais il y a une partie plus récente et plus aiguë de l'histoire que j'ai vraiment envie de comprendre, et c'est la seule chose qui m'a donné envie de construire [Positron](https://positron.today/) plus que tout le reste. Parce que notre ancien biais de négativité humain est une chose. Que se passe-t-il lorsque vous confiez ce biais à une machine dont le seul travail est de maximiser votre attention - c'est quelque chose de complètement différent.
  
  Donc, c'est l'article sur les machines.
  
  ## D'abord, les machines préfèrent vraiment les mauvaises nouvelles
  
  Établissons le fait de base avant d'aborder le comment et le pourquoi, car cela a été mesuré de manière magnifique.
  
  En 2023, une équipe dirigée par Claire Robertson a publié une étude dans Nature Human Behaviour avec le titre merveilleusement franc ["La négativité stimule la consommation de nouvelles en ligne"](https://www.nature.com/articles/s41562-023-01538-4). Ils avaient accès à quelque chose qui ressemble à un rêve de chercheur : des données d'Upworthy, qui pendant des années a réalisé d'innombrables tests A/B sur ses propres titres - la même histoire, des mots différents, montrés à de vraies personnes. Environ 105 000 variations de titres. Quelque chose comme 5,7 millions de clics. Un comportement réel, à une échelle énorme.
  
  La découverte était claire et un peu accablante. Pour un titre de longueur moyenne, chaque mot *négatif* supplémentaire augmentait le taux de clics d'environ 2,3 %. Et les mots positifs faisaient le contraire - ils poussaient les clics *vers le bas*. Le fait marquant est que les mots positifs étaient en réalité légèrement plus courants au départ. Ce n'est pas que le monde n'offre que de mauvais titres. C'est que les mauvais gagnent le clic, encore et encore, d'une manière que vous pouvez mesurer au point décimal.
  
  Voilà la matière première. Maintenant, regardez ce qui se passe quand un algorithme s'en empare.
  
  ## Ce qui se propage réellement
  
  Deux autres études, à mon avis, ouvrent cela.
  
  ![Trois résultats de recherche sur ce qui se propage en ligne : les mots négatifs augmentent les clics de deux point trois pour cent, les mots moraux-émotionnels augmentent les partages de vingt pour cent, et les publications attaquant des opposants politiques sont le facteur unique le plus fort de partage](/assets/editorials/what-spreads.svg)
  
  La première est de William Brady, Jay Van Bavel et collègues, en 2017, et elle a introduit une phrase que je me trouve à utiliser tout le temps maintenant : ["contagion morale"](https://www.pnas.org/doi/10.1073/pnas.1618923114). Ils ont examiné plus d'un demi-million de tweets sur des sujets moraux-politiques brûlants - le contrôle des armes, le mariage entre personnes de même sexe, le changement climatique - et ont découvert que chaque mot *moral-émotionnel* supplémentaire dans un message (des mots comme "attaque", "honte", "avidité", "mal") augmentait la portée de sa diffusion d'environ 20 %. Mais voici le rebondissement qui compte : cette propagation se produisait principalement *au sein* des groupes idéologiques, et non à travers eux. L'indignation voyageait vite, mais elle voyageait en cercles - approfondissant le fossé plutôt que de le traverser.
  
  La deuxième étude va un peu plus loin, et c'est celle qui me touche vraiment. En 2021, Steve Rathje, Van Bavel et Sander van der Linden ont examiné 2,7 millions de publications provenant de médias d'information et de politiciens et ont posé une question simple : quel contenu se propage le plus loin ? La réponse n'était pas la joie. Ce n'était même pas la fierté ou les éloges de groupe. Le prédicteur le plus fort d'un post partagé était ["l'animosité envers le groupe extérieur"](https://www.pnas.org/doi/10.1073/pnas.2024292118) - des publications *sur l'autre camp*, les personnes avec lesquelles vous n'êtes pas d'accord. Parler de vos adversaires politiques battait tous les autres facteurs qu'ils ont mesurés, y compris le langage émotionnel ordinaire. Rien ne se propage comme le mépris pour "eux".
  
  Prenez un moment pour réfléchir à cela. La chose la plus partageable en ligne n'est pas quelque chose de bon. Ce n'est même pas quelque chose de triste. C'est la colère envers le groupe extérieur. Voilà la forme de la demande brute - et les algorithmes sont partis à la recherche de cette forme précise.
  
  ## La preuve accablante : cinq points pour la colère
  
  C'est ici que cela cesse d'être abstrait, car pour une fois, nous n'avons pas à deviner ce qu'une plateforme optimisait. Nous avons les documents.
  
  En 2021, la lanceuse d'alerte Frances Haugen a publié une multitude de documents internes de Facebook, et parmi les choses rapportées par le [Washington Post](https://www.washingtonpost.com/technology/2021/10/26/facebook-angry-emoji-algorithm/) se trouvait un petit détail révélateur sur la façon dont le fil d'actualités était classé. Lorsque Facebook a déployé ces réactions emoji - amour, haha, wow, triste, en colère - il a décidé, à partir de 2017, de traiter toute réaction emoji comme valant *cinq fois* plus qu'un humble "j'aime" dans son algorithme de classement. Cinq points pour une réaction, un pour un j'aime.
  
  Pensez à ce que cela fait discrètement. Un "j'aime" est ce que vous donnez à quelque chose de bien. Mais vous ne tapez pas "en colère" sur une photo de chiot - vous le tapez sur la chose qui vous indigne. En pondérant les réactions cinq fois plus lourdement, Facebook était, en effet, en train d'augmenter le volume sur exactement le contenu le plus susceptible de rendre les gens furieux. Et leurs propres données, quelques années plus tard, ont confirmé l'évidence : les publications qui suscitaient beaucoup de réactions de colère étaient de manière disproportionnée susceptibles de contenir de la désinformation, de la toxicité et des nouvelles de mauvaise qualité. Le personnel avait signalé le risque dès le départ. L'entreprise a finalement fait marche arrière - en diminuant le poids, puis en rétrogradant les publications qui suscitaient une colère disproportionnée, et d'ici 2020, en réduisant la valeur de la réaction de colère à zéro.
  
  Mais pendant des années, la machine a fonctionné à plein régime. Elle ne visait pas à rendre le monde plus en colère. Elle visait à maximiser l'engagement - et il s'avère que ces deux choses sont, de manière troublante, presque la même chose.
  
  ## Laissez-moi être juste à ce sujet
  
  Maintenant, je me suis promis en commençant à écrire cela que je ne ferais pas de surenchère, alors laissez-moi poser quelques caveats honnêtes sur la table.
  
  Tout d'abord, la plupart de cela est une corrélation, et la corrélation est glissante. Montrer que le contenu négatif, en colère et du groupe extérieur se propage plus loin n'est pas la même chose que de prouver que l'algorithme *a causé* notre colère croissante. Une partie de cela est sûrement juste l'algorithme tenant un miroir à ce que nous cherchions déjà - le biais de négativité des articles précédents, maintenant simplement reflété à une vitesse industrielle. Démêler "la machine nous a rendus comme ça" de "la machine nous a donné plus de ce que nous aimions déjà" est vraiment difficile, et des chercheurs sérieux débattent encore de l'équilibre.
  
  Deuxièmement, la science se corrige elle-même, et certains de ces effets semblent plus petits ou plus conditionnels sous réplication que les chiffres frappants des titres ne le suggèrent. La direction des résultats est robuste et répétée. Les magnitudes exactes méritent de l'humilité.
  
  Mais même avec tous ces caveats, la forme de la chose est suffisamment claire. Nos cerveaux penchent vers le négatif. Le contenu qui se propage est négatif, moralisé, et vise "l'autre camp." Et les plateformes, à la recherche d'engagement, ont construit des machines qui - délibérément ou non - ont amplifié précisément cela. Le biais humain est entré par une extrémité ; une machine d'indignation est sortie par l'autre.
  
  ## Ce qui est toute la raison de l'opposé
  
  Et c'est enfin pourquoi Positron est construit de la manière dont il est construit - et pourquoi la page "comment ça fonctionne" pourrait être la chose la plus importante sur le site.
  
  Il n'y a aucun algorithme sur Positron optimisant votre engagement, car il n'y a rien à optimiser *pour*. Pas de publicités. Pas de classement de fil. Pas de boutons de réaction notant discrètement votre rage. Cela ne gagne pas un centime que vous soyez calme ou furieux, donc il n'a aucune raison d'atteindre la chose qui vous rend furieux. C'est, intentionnellement, l'exact opposé de la machine d'indignation : un petit coin délibérément non optimisé d'internet où la seule chose qui trie les nouvelles est "est-ce que c'est vraiment bon ?"
  
  Cela ne réparera pas les machines. Je suis un Belge avec un site web ; je n'ai aucune illusion. Mais cela peut être un endroit où se tenir qui n'est pas à l'intérieur de la machine - et honnêtement, certains jours, cela semble suffisant.
  
  Dans le dernier article de cette série, je veux examiner ce que tout cela - le biais, l'angoisse, la machine d'indignation - nous fait réellement. Parce qu'il s'avère que la recherche à ce sujet est assez frappante, et la recherche sur ce qu'un meilleur régime d'actualités peut faire à la place est réellement pleine d'espoir.
  
  Santé / Rik
layout: editorial.njk
---

# Five points for anger: how algorithms learned to sell us the worst of each other

![A comparison of two social media reaction buttons: a like worth one point next to an angry reaction worth five points](/assets/editorials/five-points-for-anger.svg)

Let me start with something I've noticed about my own behaviour, because it's a little embarrassing and I suspect I'm not alone. When I post something on LinkedIn - a nice project, a bit of genuine enthusiasm about some technology I love - it does fine. Politely fine. But every now and then I've watched someone post something spiky, a complaint, a bit of outrage, a "can you believe this?" - and it takes off like a rocket. More comments, more shares, more heat, in an afternoon than my sunny little posts get in a week.

For a long time I filed that under "people are just like that." And they are - we spent the last three articles establishing exactly *how* they are, wired by evolution to lean toward the negative. But there's a newer, sharper part of the story that I've been genuinely itching to understand, and it's the one thing that made me want to build [Positron](https://positron.today/) more than anything else. Because our old human negativity bias is one thing. What happens when you hand that bias to a machine whose entire job is to maximise your attention - that's something else entirely.

So this is the article about the machines.

## First, the machines really do prefer bad news

Let's establish the basic fact before we get to the how and why, because it's been measured beautifully.

In 2023, a team led by Claire Robertson published a study in Nature Human Behaviour with the wonderfully blunt title ["Negativity drives online news consumption"](https://www.nature.com/articles/s41562-023-01538-4). They had access to something close to a researcher's dream: data from Upworthy, which for years ran endless A/B tests on its own headlines - the same story, different words, shown to real people. Around 105,000 headline variations. Something like 5.7 million clicks. Real behaviour, at enormous scale.

The finding was clean and a little damning. For a headline of average length, every single additional *negative* word raised the click-through rate by about 2.3%. And positive words did the opposite - they pushed clicks *down*. The kicker is that positive words were actually slightly more common to begin with. It's not that the world only offers bad headlines. It's that the bad ones win the click, over and over, in a way you can measure to the decimal point.

That's the raw material. Now watch what happens when an algorithm gets hold of it.

## What actually spreads

Two more studies, to my mind, crack this open.

![Three research findings on what spreads online: negative words lift clicks by two point three percent, moral-emotional words lift shares by twenty percent, and posts attacking political opponents are the single strongest driver of sharing](/assets/editorials/what-spreads.svg)

The first is from William Brady, Jay Van Bavel and colleagues, in 2017, and it introduced a phrase I find myself using all the time now: ["moral contagion"](https://www.pnas.org/doi/10.1073/pnas.1618923114). They looked at more than half a million tweets about hot moral-political topics - gun control, same-sex marriage, climate change - and found that every additional *moral-emotional* word in a message (words like "attack", "shame", "greed", "evil") increased how far it spread by around 20%. But here's the twist that matters: that spread happened mostly *within* ideological groups, not across them. Outrage travelled fast, but it travelled in circles - deepening the divide rather than crossing it.

The second study takes it one step further, and it's the one that really lands for me. In 2021, Steve Rathje, Van Bavel and Sander van der Linden looked at 2.7 million posts from news outlets and politicians and asked a simple question: what content spreads furthest? The answer wasn't joy. It wasn't even in-group pride or praise. The single strongest predictor of a post being shared was ["out-group animosity"](https://www.pnas.org/doi/10.1073/pnas.2024292118) - posts *about the other side*, the people you disagree with. Talking about your political opponents beat every other factor they measured, including plain old emotional language. Nothing spreads like contempt for "them."

Sit with that for a second. The most shareable thing online is not something good. It is not even something sad. It is anger at the out-group. That's the shape of the raw demand - and the algorithms went looking for exactly that shape.

## The smoking gun: five points for anger

Here's where it stops being abstract, because for once we don't have to guess what a platform was optimising for. We have the documents.

In 2021, the whistleblower Frances Haugen released a trove of internal Facebook material, and among the things reported by the [Washington Post](https://www.washingtonpost.com/technology/2021/10/26/facebook-angry-emoji-algorithm/) was a small, revealing detail about how the news feed was ranked. When Facebook rolled out those emoji reactions - love, haha, wow, sad, angry - it decided, starting in 2017, to treat any emoji reaction as worth *five times* more than a humble "like" in its ranking algorithm. Five points for a reaction, one for a like.

Think about what that quietly does. A "like" is what you give to something nice. But you don't tap "angry" on a puppy photo - you tap it on the thing that outrages you. By weighting reactions five times heavier, Facebook was, in effect, turning up the volume on exactly the content most likely to make people furious. And their own data, a couple of years later, confirmed the obvious: posts that drew a lot of angry reactions were disproportionately likely to contain misinformation, toxicity, and low-quality news. Staff had flagged the risk from the start. The company eventually walked it back - downgrading the weighting, then demoting posts that drew disproportionate anger, and by 2020 cutting the angry reaction's value all the way to zero.

But for years, the machine ran hot. It didn't set out to make the world angrier. It set out to maximise engagement - and it turns out those two things are, disturbingly, almost the same thing.

## Let me be fair about this

Now, I promised myself when I started writing these that I wouldn't overclaim, so let me put some honest caveats on the table.

First, most of this is correlation, and correlation is slippery. Showing that angry, negative, out-group content spreads further is not the same as proving the algorithm *caused* us to become angrier people. Some of it is surely just the algorithm holding up a mirror to what we were already reaching for - the negativity bias from the earlier articles, now simply reflected back at industrial speed. Untangling "the machine made us like this" from "the machine gave us more of what we already liked" is genuinely hard, and serious researchers still argue about the balance.

Second, science self-corrects, and some of these effects look smaller or more conditional under replication than the striking headline numbers suggest. The direction of the findings is robust and repeated. The exact magnitudes deserve humility.

But even with all those caveats, the shape of the thing is clear enough. Our brains lean negative. The content that spreads is negative, moralised, and aimed at "the other side." And the platforms, chasing engagement, built machinery that - deliberately or not - amplified precisely that. Human bias went in one end; an outrage machine came out the other.

## Which is the whole reason for the opposite

And this, finally, is why Positron is built the way it is - and why the "how it works" page might be the most important thing on the site.

There is no algorithm on Positron optimising for your engagement, because there is nothing to optimise *for*. No ads. No feed ranking. No reaction buttons quietly scoring your rage. It doesn't earn a cent whether you're calm or furious, so it has no reason to reach for the thing that makes you furious. It is, on purpose, the exact opposite of the outrage machine: a small, deliberately un-optimised corner of the internet where the only thing sorting the news is "is this actually good?"

That won't fix the machines. I'm one Belgian with a website; I have no illusions. But it can be a place to stand that isn't inside the machine - and honestly, some days that feels like enough.

In the final article of this series, I want to look at what all of this - the bias, the dread, the outrage machine - actually does to us. Because it turns out the research on that is pretty stark, and the research on what a better news diet can do instead is genuinely hopeful.

Cheers / Rik
