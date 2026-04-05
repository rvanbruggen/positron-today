# Briefing document for new website project "Positiviteiten"

## Background

For several years, I have been quite frustrated by the fact that both on traditional media and on social media there is a clear bias towards negative news. Negative news, just because of the nature of human beings, is easier to sell, easier to get clicks for, easier to promote, and easier to go viral. Therefore, it just gets biased in every publication that you find online. Clearly, there is also positive news to be told, but it always gets snowed under by the negative news. This is mostly for commercial reasons, in my opinion, and I want to try and do something about that. That's what this website project called "Positiviteiten" / "Positivities" / "Positivités" is all about. 

## General instructions
- The idea of the system would be that we find articles that are positively inclined or have some kind of funny aspect to it, or that would make people laugh or give them a good feeling. This is based on publicly available (sometimes behind the paywall) articles that would give people a positive vibe. We would then catalogue these articles, summarise them, give a personal take on it wherever possible, and then publish those as a tiny little pane on the website. That would allow people to very easily see what the positive news is that is coming in, and then link to that and go to the source article source website very, very easily. 
- The system would allow you to access these articles in different languages by locality or geography, but also by topic and by publication source. 
- We should make the system a multilingual system where content is uploaded in one voice in one language and then is automatically translated into other languages as necessary. 


### Application flow
I currently see three parts to the application. 
1. A management part where we basically configure the main attributes of the system. This would include: 
   - The source website of these source articles. This could be a blog, a traditional news media website, a Twitter handle, a Facebook account, an Instagram account. It could be any of the above. Basically, we would have a URL of a collection of potential source articles. 
   - The topics that we have found and have catalogued for these positive articles 
   - The publication date of our summary page that we would put onto the website 
   - The history of all of our articles and publications that we have put onto the website 
2. A preview part where the system would suggest a number of articles that could be viable publication targets for the website. This would just be a very simple preview of the article where the administrator (myself or someone else that has access to the admin pages) will be able to preview the article and then decide what to do with it. We will basically be able to discard it, Or be able to publish it on a specific date. We want to make sure that we create some kind of a regular flow of positive articles that are published on a regular basis. 
3. A publishing part, Where we ask the system to do all of the necessary work to catalog and translate and then publish the final website as it would go live to its viewers.

### Look and feel

- I would like the look and feel to represent some kind of a positive atmosphere: happy, summery, bright colors, but of course also stylish and modern. Not too many bells and whistles, but still a very positive-looking atmosphere. 
- I would like every post that we create to have some kind of an icon associated with it. Therefore, I would like to have some kind of an icon library that we can associate with every single post. 

### Tone of voice
Please adopt my writing style. You will find a rix-writing-style.md document in the root of the repo. 
In all publications, we should always have a positive mindset and have a positive tone of voice for every piece we write. 


## Technical setup
- Ideally, I want to keep the setup as simple as possible and work with static web pages that we can maintain really easily on GitHub pages. Please make a suggestion of how to do this, and also make sure that we can always have a version management system in place based on Git for every publication. 
- I do not want to be paying lots of money for the system to be deployed, so I would really prefer not to have any kind of expensive backend system for the system. Ideally, we would have some kind of a SQLite database for metadata that we can store locally and back up and restore to the management page of the system if at all necessary. 
