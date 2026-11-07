import type { BookId, PracticeItem, SeedArticle, SeedWord } from './types.ts';

function parse(book: BookId, startId: number, difficulty: number, text: string): SeedWord[] {
  return text
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [word, phonetic, translation, example, exampleZh] = line.split('|');
      return {
        id: startId + index,
        word,
        phonetic,
        translation,
        example,
        exampleZh,
        book,
        difficulty,
      };
    });
}

const primary = parse('primary', 1, 1, `
cat|/kæt/|猫|I have a cat.|我有一只猫。
dog|/dɒɡ/|狗|The dog is big.|这只狗很大。
bird|/bɜːd/|鸟|A bird can fly.|鸟会飞。
fish|/fɪʃ/|鱼|Fish live in water.|鱼住在水里。
duck|/dʌk/|鸭子|The duck can swim.|鸭子会游泳。
pig|/pɪɡ/|猪|The pig is pink.|这头猪是粉色的。
cow|/kaʊ/|牛|The cow eats grass.|牛吃草。
horse|/hɔːs/|马|I can see a horse.|我看见一匹马。
sheep|/ʃiːp/|羊|Three sheep are here.|这里有三只羊。
rabbit|/ˈræbɪt/|兔子|The rabbit is white.|这只兔子是白的。
tiger|/ˈtaɪɡə/|老虎|The tiger is big.|老虎很大。
lion|/ˈlaɪən/|狮子|A lion is strong.|狮子很壮。
monkey|/ˈmʌŋki/|猴子|The monkey likes bananas.|猴子喜欢香蕉。
panda|/ˈpændə/|熊猫|The panda eats bamboo.|熊猫吃竹子。
bear|/beə/|熊|The bear is brown.|这只熊是棕色的。
frog|/frɒɡ/|青蛙|A frog can jump.|青蛙会跳。
bee|/biː/|蜜蜂|The bee is on the flower.|蜜蜂停在花上。
apple|/ˈæpl/|苹果|I eat an apple.|我吃一个苹果。
banana|/bəˈnɑːnə/|香蕉|The banana is yellow.|香蕉是黄的。
orange|/ˈɒrɪndʒ/|橙子|I like oranges.|我喜欢橙子。
milk|/mɪlk/|牛奶|I drink milk.|我喝牛奶。
water|/ˈwɔːtə/|水|Please drink water.|请喝水。
bread|/bred/|面包|The bread is warm.|面包是热的。
rice|/raɪs/|米饭|We eat rice.|我们吃米饭。
egg|/eɡ/|鸡蛋|I want an egg.|我想要一个鸡蛋。
cake|/keɪk/|蛋糕|The cake is sweet.|蛋糕是甜的。
tea|/tiː/|茶|Mom drinks tea.|妈妈喝茶。
juice|/dʒuːs/|果汁|Apple juice is sweet.|苹果汁是甜的。
candy|/ˈkændi/|糖果|The candy is red.|这颗糖是红的。
book|/bʊk/|书|This is my book.|这是我的书。
pen|/pen/|钢笔|I write with a pen.|我用钢笔写字。
pencil|/ˈpensl/|铅笔|The pencil is yellow.|铅笔是黄的。
desk|/desk/|书桌|The book is on the desk.|书在书桌上。
chair|/tʃeə/|椅子|Please sit on the chair.|请坐在椅子上。
school|/skuːl/|学校|We go to school.|我们去上学。
teacher|/ˈtiːtʃə/|老师|The teacher is kind.|老师很和气。
student|/ˈstjuːdnt/|学生|I am a student.|我是学生。
class|/klɑːs/|班级|Our class is quiet.|我们班很安静。
bag|/bæɡ/|书包|My bag is blue.|我的书包是蓝色的。
paper|/ˈpeɪpə/|纸|I need some paper.|我需要一些纸。
read|/riːd/|读|I read every day.|我每天读书。
write|/raɪt/|写|Please write your name.|请写下你的名字。
learn|/lɜːn/|学习|We learn English.|我们学英语。
word|/wɜːd/|单词|This word is new.|这个单词是新的。
letter|/ˈletə/|字母|A is a letter.|A 是一个字母。
mom|/mɒm/|妈妈|Mom is at home.|妈妈在家。
dad|/dæd/|爸爸|Dad has a flag.|爸爸有一面旗。
sister|/ˈsɪstə/|姐姐；妹妹|My sister can sing.|我的姐姐会唱歌。
brother|/ˈbrʌðə/|哥哥；弟弟|My brother likes football.|我的哥哥喜欢足球。
baby|/ˈbeɪbi/|宝宝|The baby is asleep.|宝宝睡着了。
family|/ˈfæməli/|家庭|I love my family.|我爱我的家。
friend|/frend/|朋友|She is my friend.|她是我的朋友。
home|/həʊm/|家|I go home at five.|我五点回家。
red|/red/|红色|The apple is red.|苹果是红的。
blue|/bluː/|蓝色|The sky is blue.|天空是蓝色的。
green|/ɡriːn/|绿色|The grass is green.|草是绿的。
yellow|/ˈjeləʊ/|黄色|The sun looks yellow.|太阳看上去是黄的。
black|/blæk/|黑色|The bag is black.|书包是黑的。
white|/waɪt/|白色|The rabbit is white.|兔子是白的。
pink|/pɪŋk/|粉色|The flower is pink.|这朵花是粉色的。
brown|/braʊn/|棕色|The bear is brown.|熊是棕色的。
hand|/hænd/|手|Wash your hands.|洗洗手。
head|/hed/|头|My head is here.|这是我的头。
eye|/aɪ/|眼睛|I have two eyes.|我有两只眼睛。
ear|/ɪə/|耳朵|I listen with my ears.|我用耳朵听。
nose|/nəʊz/|鼻子|The dog has a black nose.|这只狗有个黑鼻子。
mouth|/maʊθ/|嘴|Open your mouth.|张开嘴。
foot|/fʊt/|脚|My foot is small.|我的脚很小。
hair|/heə/|头发|Her hair is long.|她的头发很长。
sun|/sʌn/|太阳|The sun is hot.|太阳很热。
moon|/muːn/|月亮|The moon is bright.|月亮很亮。
star|/stɑː/|星星|I see a star.|我看见一颗星。
rain|/reɪn/|雨|The rain is cold.|雨是冷的。
snow|/snəʊ/|雪|Snow is white.|雪是白的。
wind|/wɪnd/|风|The wind is strong.|风很大。
tree|/triː/|树|The tree is tall.|这棵树很高。
flower|/ˈflaʊə/|花|The flower is red.|这朵花是红的。
grass|/ɡrɑːs/|草|Sit on the grass.|坐在草地上。
cloud|/klaʊd/|云|A white cloud is in the sky.|天上有一朵白云。
sky|/skaɪ/|天空|The sky is blue.|天空是蓝的。
run|/rʌn/|跑|I can run fast.|我能跑得很快。
jump|/dʒʌmp/|跳|Frogs can jump.|青蛙会跳。
walk|/wɔːk/|走|We walk to school.|我们走路上学。
swim|/swɪm/|游泳|I can swim.|我会游泳。
sing|/sɪŋ/|唱歌|Please sing a song.|请唱一首歌。
open|/ˈəʊpən/|打开|Open the door.|打开门。
close|/kləʊz/|关闭|Close the window.|关上窗。
play|/pleɪ/|玩|We play after class.|我们课后玩。
look|/lʊk/|看|Look at the bird.|看那只鸟。
listen|/ˈlɪsn/|听|Listen to the teacher.|听老师讲。
eat|/iːt/|吃|I eat an apple.|我吃苹果。
drink|/drɪŋk/|喝|Drink some water.|喝点水。
sleep|/sliːp/|睡觉|I sleep at nine.|我九点睡觉。
sit|/sɪt/|坐|Please sit down.|请坐下。
big|/bɪɡ/|大的|The elephant is big.|大象很大。
small|/smɔːl/|小的|The ant is small.|蚂蚁很小。
happy|/ˈhæpi/|开心的|I am happy.|我很开心。
sad|/sæd/|难过的|The lad is sad.|这个男孩有点难过。
good|/ɡʊd/|好的|This is a good book.|这是一本好书。
new|/njuː/|新的|I have a new pen.|我有一支新钢笔。
old|/əʊld/|旧的；年老的|The clock is old.|这座钟很旧。
hot|/hɒt/|热的|The tea is hot.|茶是热的。
cold|/kəʊld/|冷的|The water is cold.|水是冷的。
fast|/fɑːst/|快的|The horse is fast.|这匹马很快。
slow|/sləʊ/|慢的|The turtle is slow.|乌龟很慢。
clean|/kliːn/|干净的|The room is clean.|房间很干净。
door|/dɔː/|门|Please open the door.|请开门。
window|/ˈwɪndəʊ/|窗户|The window is open.|窗户开着。
bed|/bed/|床|The bed is soft.|床很软。
room|/ruːm/|房间|This is my room.|这是我的房间。
light|/laɪt/|灯；光|Turn on the light.|开灯。
clock|/klɒk/|钟|The clock says six.|钟上是六点。
key|/kiː/|钥匙|Where is the key?|钥匙在哪？
ball|/bɔːl/|球|Kick the ball.|踢球。
bike|/baɪk/|自行车|I ride a bike.|我骑自行车。
car|/kɑː/|汽车|The car is red.|汽车是红色的。
bus|/bʌs/|公共汽车|We take the bus.|我们坐公共汽车。
one|/wʌn/|一|I have one cat.|我有一只猫。
two|/tuː/|二|I have two eyes.|我有两只眼睛。
three|/θriː/|三|I see three birds.|我看见三只鸟。
four|/fɔː/|四|Four apples are here.|这里有四个苹果。
five|/faɪv/|五|I am five.|我五岁。
all|/ɔːl/|全部|They all fall.|他们都倒下了。
fall|/fɔːl/|落下|Leaves fall.|叶子落下。
ask|/ɑːsk/|问|Dad asks a question.|爸爸问了一个问题。
salad|/ˈsæləd/|沙拉|I like salad.|我喜欢沙拉。
flask|/flɑːsk/|水瓶|The flask is full.|水瓶是满的。
lass|/læs/|女孩|The lass has a flag.|女孩有一面旗。
lad|/læd/|男孩|A sad lad sits.|一个难过的男孩坐着。
flag|/flæɡ/|旗|The flag is red.|旗是红色的。
hall|/hɔːl/|大厅|We meet in the hall.|我们在大厅见面。
glass|/ɡlɑːs/|玻璃杯|A glass of milk.|一杯牛奶。
has|/hæz/|有|Dad has a flag.|爸爸有一面旗。
had|/hæd/|有过|I had an apple.|我吃过一个苹果。
shall|/ʃæl/|将|We shall read.|我们将要读。
falls|/fɔːlz/|落下|The flag falls.|旗倒了。
asks|/ɑːsks/|问|She asks me.|她问我。
we|/wiː/|我们|We like apples.|我们喜欢苹果。
you|/juː/|你；你们|You are kind.|你很友好。
like|/laɪk/|喜欢|I like the dog.|我喜欢这只狗。
the|/ðə/|这；那|The sun is hot.|太阳很热。
up|/ʌp/|向上|Stand up.|站起来。
here|/hɪə/|这里|Come here.|到这里来。
little|/ˈlɪtl/|小的|A little star.|一颗小星星。
year|/jɪə/|年|Happy new year.|新年快乐。
your|/jɔː/|你的|This is your book.|这是你的书。
she|/ʃiː/|她|She can sing.|她会唱歌。
he|/hiː/|他|He can swim.|他会游泳。
her|/hɜː/|她；她的|I see her.|我看见她。
see|/siː/|看见|I see a bird.|我看见一只鸟。
yes|/jes/|是的|Yes, I do.|是的。
pretty|/ˈprɪti/|漂亮的|The flower is pretty.|这朵花很漂亮。
power|/ˈpaʊə/|力量|The wind has power.|风有力量。
quit|/kwɪt/|退出|Do not quit.|不要放弃。
pie|/paɪ/|派|The pie is hot.|派是热的。
they|/ðeɪ/|他们|They are friends.|他们是朋友。
what|/wɒt/|什么|What is this?|这是什么？
there|/ðeə/|那里|The book is there.|书在那里。
food|/fuːd/|食物|The food is good.|食物很好。
zoo|/zuː/|动物园|We go to the zoo.|我们去动物园。
box|/bɒks/|盒子|The cat is in the box.|猫在盒子里。
can|/kæn/|能；罐子|I can read.|我能读。
van|/væn/|小货车|The van is blue.|小货车是蓝色的。
man|/mæn/|男人|The man is tall.|这个人很高。
name|/neɪm/|名字|My name is Ann.|我的名字是安。
catches|/ˈkætʃɪz/|接住|He catches the ball.|他接住了球。
`);

const junior = parse('junior', 400, 2, `
because|/bɪˈkɒz/|因为|I stay home because it rains.|因为下雨，我待在家里。
although|/ɔːlˈðəʊ/|虽然|Although it is cold, we walk.|虽然冷，我们还是走路。
before|/bɪˈfɔː/|在……之前|Wash your hands before dinner.|吃饭前洗手。
after|/ˈɑːftə/|在……之后|We play after class.|我们课后玩。
always|/ˈɔːlweɪz/|总是|She always reads at night.|她总是晚上读书。
never|/ˈnevə/|从不|I never quit.|我从不放弃。
sometimes|/ˈsʌmtaɪmz/|有时|Sometimes I ride a bike.|我有时骑自行车。
remember|/rɪˈmembə/|记住|Remember this word.|记住这个单词。
forget|/fəˈɡet/|忘记|Do not forget your bag.|别忘了书包。
practice|/ˈpræktɪs/|练习|Practice for one minute.|练习一分钟。
mistake|/mɪˈsteɪk/|错误|A mistake helps me learn.|错误帮我学习。
correct|/kəˈrekt/|正确的|Your answer is correct.|你的答案是对的。
answer|/ˈɑːnsə/|答案|Write the answer.|写下答案。
question|/ˈkwestʃən/|问题|Ask a question.|问一个问题。
language|/ˈlæŋɡwɪdʒ/|语言|English is a language.|英语是一种语言。
sentence|/ˈsentəns/|句子|Read the sentence.|读这个句子。
keyboard|/ˈkiːbɔːd/|键盘|Put your hands on the keyboard.|把手放在键盘上。
finger|/ˈfɪŋɡə/|手指|Use the correct finger.|用对的手指。
courage|/ˈkʌrɪdʒ/|勇气|It takes courage to try again.|再试一次需要勇气。
honest|/ˈɒnɪst/|诚实的|Be honest.|要诚实。
patient|/ˈpeɪʃnt/|耐心的|Be patient with yourself.|对自己耐心一点。
discover|/dɪˈskʌvə/|发现|I discover a new word.|我发现一个新单词。
journey|/ˈdʒɜːni/|旅程|The journey is long.|旅程很长。
library|/ˈlaɪbrəri/|图书馆|We read in the library.|我们在图书馆读书。
science|/ˈsaɪəns/|科学|I like science.|我喜欢科学。
weather|/ˈweðə/|天气|The weather is fine.|天气很好。
healthy|/ˈhelθi/|健康的|Milk is healthy.|牛奶有益健康。
important|/ɪmˈpɔːtnt/|重要的|Water is important.|水很重要。
different|/ˈdɪfrənt/|不同的|These words are different.|这些单词不一样。
together|/təˈɡeðə/|一起|We learn together.|我们一起学。
already|/ɔːlˈredi/|已经|I already know this word.|我已经认识这个单词。
enough|/ɪˈnʌf/|足够的|One minute is enough.|一分钟就够了。
careful|/ˈkeəfl/|小心的|Be careful with the keys.|按键时小心。
quiet|/ˈkwaɪət/|安静的|The room is quiet.|房间很安静。
bright|/braɪt/|明亮的|The moon is bright.|月亮很亮。
future|/ˈfjuːtʃə/|未来|Practice for the future.|为将来练习。
protect|/prəˈtekt/|保护|Protect the trees.|保护树木。
environment|/ɪnˈvaɪrənmənt/|环境|Keep the environment clean.|保持环境干净。
knowledge|/ˈnɒlɪdʒ/|知识|Books give us knowledge.|书给我们知识。
habit|/ˈhæbɪt/|习惯|A daily habit helps.|每天的习惯有用。
`);

const sentence = parse('sentence', 700, 2, `
I have a cat.|/aɪ hæv ə kæt/|我有一只猫。|I have a cat.|我有一只猫。
The sun is hot.|/ðə sʌn ɪz hɒt/|太阳很热。|The sun is hot.|太阳很热。
She likes apples.|/ʃiː laɪks ˈæplz/|她喜欢苹果。|She likes apples.|她喜欢苹果。
We go to school.|/wiː ɡəʊ tə skuːl/|我们去上学。|We go to school.|我们去上学。
Please open the door.|/pliːz ˈəʊpən ðə dɔː/|请开门。|Please open the door.|请开门。
My friend is kind.|/maɪ frend ɪz kaɪnd/|我的朋友很友善。|My friend is kind.|我的朋友很友善。
Birds fly in the sky.|/bɜːdz flaɪ ɪn ðə skaɪ/|鸟在天上飞。|Birds fly in the sky.|鸟在天上飞。
I drink milk every day.|/aɪ drɪŋk mɪlk ˈevri deɪ/|我每天喝牛奶。|I drink milk every day.|我每天喝牛奶。
The book is on the desk.|/ðə bʊk ɪz ɒn ðə desk/|书在书桌上。|The book is on the desk.|书在书桌上。
He can swim very well.|/hiː kæn swɪm ˈveri wel/|他游泳游得很好。|He can swim very well.|他游泳游得很好。
Thank you for your help.|/θæŋk juː fɔː jɔː help/|谢谢你的帮助。|Thank you for your help.|谢谢你的帮助。
Practice makes you better.|/ˈpræktɪs meɪks juː ˈbetə/|练习会让你更好。|Practice makes you better.|练习会让你更好。
I want to learn English.|/aɪ wɒnt tə lɜːn ˈɪŋɡlɪʃ/|我想学英语。|I want to learn English.|我想学英语。
The flower is red and small.|/ðə ˈflaʊə ɪz red ənd smɔːl/|这朵花又红又小。|The flower is red and small.|这朵花又红又小。
We play football after class.|/wiː pleɪ ˈfʊtbɔːl ˈɑːftə klɑːs/|我们课后踢足球。|We play football after class.|我们课后踢足球。
Please listen to the teacher.|/pliːz ˈlɪsn tə ðə ˈtiːtʃə/|请听老师讲。|Please listen to the teacher.|请听老师讲。
Hello, dad.|/həˈləʊ dæd/|你好，爸爸。|Hello, dad.|你好，爸爸。
I like salad.|/aɪ laɪk ˈsæləd/|我喜欢沙拉。|I like salad.|我喜欢沙拉。
Dad has a flag.|/dæd hæz ə flæɡ/|爸爸有一面旗。|Dad has a flag.|爸爸有一面旗。
A sad lad.|/ə sæd læd/|一个难过的男孩。|A sad lad.|一个难过的男孩。
I have 2 cats!|/aɪ hæv tuː kæts/|我有两只猫！|I have 2 cats!|我有两只猫！
No. 5 is a book.|/nʌmbə faɪv ɪz ə bʊk/|第 5 个是一本书。|No. 5 is a book.|第 5 个是一本书。
dad has a flag|/dæd hæz ə flæɡ/|爸爸有一面旗。|dad has a flag|爸爸有一面旗。
a sad lad|/ə sæd læd/|一个难过的男孩。|a sad lad|一个难过的男孩。
all fall|/ɔːl fɔːl/|都落下。|all fall|都落下。
`);

export const SEED_WORDS: SeedWord[] = [...primary, ...junior, ...sentence];

export const SEED_ARTICLES: SeedArticle[] = [
  {
    id: 1,
    title: '我的猫',
    sentences: [
      { en: 'I have a little cat.', zh: '我有一只小猫。' },
      { en: 'She is white and quiet.', zh: '她又白又安静。' },
      { en: 'She likes milk and sleep.', zh: '她喜欢牛奶和睡觉。' },
      { en: 'I read a book beside her.', zh: '我在她旁边看书。' },
      { en: 'The cat is my good friend.', zh: '这只猫是我的好朋友。' },
    ],
  },
  {
    id: 2,
    title: '上学的一天',
    sentences: [
      { en: 'I go to school at seven.', zh: '我七点去上学。' },
      { en: 'My teacher reads a story.', zh: '老师读了一个故事。' },
      { en: 'We learn five new words.', zh: '我们学了五个新单词。' },
      { en: 'After class we play ball.', zh: '课后我们玩球。' },
      { en: 'I walk home with my friend.', zh: '我和朋友一起走回家。' },
    ],
  },
  {
    id: 3,
    title: '下雨的周日',
    sentences: [
      { en: 'The rain is cold today.', zh: '今天的雨很冷。' },
      { en: 'I stay in my room.', zh: '我待在自己的房间。' },
      { en: 'I drink hot milk.', zh: '我喝热牛奶。' },
      { en: 'Then I write new words.', zh: '然后我写新单词。' },
      { en: 'The sky is bright again.', zh: '天空又亮起来了。' },
    ],
  },
  {
    id: 4,
    title: '小花园',
    sentences: [
      { en: 'Our garden has a tree.', zh: '我们的花园里有一棵树。' },
      { en: 'Red flowers grow under it.', zh: '树下长着红花。' },
      { en: 'A bee sits on a flower.', zh: '一只蜜蜂停在花上。' },
      { en: 'Birds sing in the morning.', zh: '鸟儿在早上唱歌。' },
      { en: 'I water the flowers.', zh: '我给花浇水。' },
    ],
  },
];

export function wordBySpelling(spelling: string, book?: BookId): SeedWord | undefined {
  return SEED_WORDS.find((word) => word.word === spelling && (book == null || word.book === book));
}

export function itemFromSeed(word: SeedWord, suffix: string): PracticeItem {
  return {
    id: `seed-${word.id}-${suffix}`,
    prompt: word.word,
    meaning: word.translation,
    phonetic: word.phonetic,
    example: word.example,
    exampleZh: word.exampleZh,
    speak: word.word,
    wordId: word.id,
  };
}
