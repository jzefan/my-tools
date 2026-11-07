import { itemFromSeed, wordBySpelling } from './catalog.ts';
import { homeReturn, homeReturnNote } from './keyboard.ts';
import type { Lesson, PracticeItem, PracticeRun } from './types.ts';

let lineSeq = 0;

function line(prompt: string, extra: Partial<PracticeItem> = {}): PracticeItem {
  lineSeq += 1;
  return { id: `line-${lineSeq}`, prompt, ...extra };
}

function spellings(list: string[], suffix: string): PracticeItem[] {
  return list.flatMap((spelling) => {
    const word = wordBySpelling(spelling);
    return word ? [itemFromSeed(word, suffix)] : [];
  });
}

function returns(keys: string[], suffix: string): PracticeItem[] {
  return keys.map((key, index) => line(homeReturn(key), {
    id: `${suffix}-return-${index}`,
    note: homeReturnNote(key),
  }));
}

function buildLessons(): Lesson[] {
  return [
    {
      id: 'know',
      title: '认识键盘',
      newKeys: 'A S D F J K L ;',
      passAccuracy: 0.9,
      steps: [
        {
          id: 'know:0',
          title: '八个基准键',
          items: [
            line('aaaa', { meaning: '左小指' }),
            line('ssss', { meaning: '左无名指' }),
            line('dddd', { meaning: '左中指' }),
            line('ffff', { meaning: '左食指' }),
            line('jjjj', { meaning: '右食指' }),
            line('kkkk', { meaning: '右中指' }),
            line('llll', { meaning: '右无名指' }),
            line(';;;;', { meaning: '右小指' }),
          ],
        },
        {
          id: 'know:1',
          title: '左右交替',
          items: [
            line('fj fj fj fj'),
            line('dk dk dk dk'),
            line('sl sl sl sl'),
            line('a; a; a; a;'),
            line('asdf jkl;'),
            line('asdf jkl; asdf jkl;'),
          ],
        },
        {
          id: 'know:2',
          title: '基准键单词',
          items: spellings(['dad', 'sad', 'fall', 'ask', 'all', 'salad', 'flask', 'flag'], 'know'),
        },
      ],
    },
    {
      id: 'home',
      title: '中排基准键',
      newKeys: 'G H',
      passAccuracy: 0.9,
      steps: [
        {
          id: 'home:0',
          title: '加上 G H',
          items: [
            ...returns(['g', 'h'], 'home'),
            line('fgf jhj fgf jhj'),
            line('asdf ghj; ;jhg fdsa'),
          ],
        },
        {
          id: 'home:1',
          title: '中排单词',
          items: spellings(['hall', 'glass', 'has', 'had', 'lass', 'lad', 'asks', 'falls'], 'home'),
        },
        {
          id: 'home:2',
          title: '短句',
          items: spellings(['dad has a flag', 'a sad lad', 'all fall'], 'home-sentence'),
        },
      ],
    },
    {
      id: 'top',
      title: '上排',
      newKeys: 'Q W E R T Y U I O P',
      passAccuracy: 0.9,
      steps: [
        {
          id: 'top:0',
          title: 'E 和 I',
          items: [
            ...returns(['e', 'i'], 'top-ei'),
            line('ded kik ded kik'),
          ],
        },
        {
          id: 'top:1',
          title: '其余上排',
          items: returns(['r', 'u', 'w', 'o', 'q', 'p', 't', 'y'], 'top-rest'),
        },
        {
          id: 'top:2',
          title: '上排单词',
          items: spellings(['red', 'tree', 'you', 'like', 'water', 'flower', 'apple', 'yellow', 'white', 'happy', 'little', 'star'], 'top'),
        },
      ],
    },
    {
      id: 'bottom',
      title: '下排',
      newKeys: 'Z X C V B N M',
      passAccuracy: 0.9,
      steps: [
        {
          id: 'bottom:0',
          title: '从基准键下去',
          items: returns(['z', 'x', 'c', 'v', 'b', 'n', 'm'], 'bottom'),
        },
        {
          id: 'bottom:1',
          title: '下排单词',
          items: spellings(['zoo', 'box', 'can', 'van', 'man', 'name', 'cat', 'bird', 'hand', 'jump', 'milk', 'blue'], 'bottom'),
        },
        {
          id: 'bottom:2',
          title: '再认几个',
          items: spellings(['book', 'window', 'black', 'green', 'car', 'bus', 'pen', 'moon'], 'bottom-2'),
        },
      ],
    },
    {
      id: 'shift',
      title: '大写与标点',
      newKeys: 'Shift , . ?',
      passAccuracy: 0.9,
      steps: [
        {
          id: 'shift:0',
          title: '大写',
          items: [
            line(homeReturn('E'), { note: 'd E d' }),
            line(homeReturn('I'), { note: 'k I k' }),
            line('Hello Hello'),
            line('Apple Apple'),
          ],
        },
        {
          id: 'shift:1',
          title: '逗号句号',
          items: [
            line('dad, dad, dad.'),
            line('red, blue, green.'),
            ...spellings(['Hello, dad.', 'I like salad.', 'A sad lad.'], 'shift'),
          ],
        },
        {
          id: 'shift:2',
          title: '问句',
          items: [
            line('What is this?'),
            line('Is the cat red?'),
            line('Can you see the star?'),
          ],
        },
      ],
    },
    {
      id: 'digit',
      title: '数字与符号',
      newKeys: '1–0  ! ?',
      passAccuracy: 0.85,
      steps: [
        {
          id: 'digit:0',
          title: '数字',
          items: [
            line('123 456 789 0'),
            line('1111 2222 3333'),
            line('5555 8888 0000'),
            ...returns(['1', '5', '0'], 'digit'),
          ],
        },
        {
          id: 'digit:1',
          title: '句子里的数字',
          items: spellings(['I have 2 cats!', 'No. 5 is a book.'], 'digit-sentence'),
        },
        {
          id: 'digit:2',
          title: '常用符号',
          items: [
            line("it's it's"),
            line('well-known well-known'),
            line('Hello! Hello!'),
            line('(ok) (ok)'),
          ],
        },
      ],
    },
    {
      id: 'language',
      title: '单词、句子和拼音',
      newKeys: '词 句 拼音',
      passAccuracy: 0.9,
      steps: [
        {
          id: 'language:0',
          title: '单词',
          items: spellings(['school', 'teacher', 'friend', 'family', 'water', 'flower', 'listen', 'happy'], 'lang'),
        },
        {
          id: 'language:1',
          title: '句子',
          items: spellings([
            'We go to school.',
            'The book is on the desk.',
            'Please listen to the teacher.',
            'I want to learn English.',
          ], 'lang-sentence'),
        },
        {
          id: 'language:2',
          title: '拼音',
          items: [
            line('ni hao', { meaning: '你好', speak: '你好' }),
            line('xie xie', { meaning: '谢谢' }),
            line('zhong guo', { meaning: '中国' }),
            line('peng you', { meaning: '朋友' }),
            line('xue xiao', { meaning: '学校' }),
            line('lao shi', { meaning: '老师' }),
            line('zai jian', { meaning: '再见' }),
          ],
        },
      ],
    },
    {
      id: 'code',
      title: '小程序员',
      newKeys: '( ) [ ] { }',
      passAccuracy: 0.85,
      steps: [
        {
          id: 'code:0',
          title: '括号',
          items: [
            line('() [] {} <>'),
            line('(a) [b] {c}'),
            line('()() [][] {}{}'),
          ],
        },
        {
          id: 'code:1',
          title: '一行代码',
          items: [
            line('let n = 1;', { meaning: '声明一个数' }),
            line('const name = "ann";', { meaning: '声明一个名字' }),
            line('console.log("hi");', { meaning: '在屏幕上写出 hi' }),
          ],
        },
        {
          id: 'code:2',
          title: '一小段',
          items: [
            line('if (ok) {\n  return 0;\n}', { meaning: '如果没问题，就返回 0' }),
            line('for (i) {\n  n = n + 1;\n}', { meaning: '重复把 n 加 1' }),
          ],
        },
      ],
    },
  ];
}

export const LESSONS: Lesson[] = buildLessons();

export const DEFAULT_WARM_KEYS = ['e', 'i', 'r', 'u'];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.id === id);
}

export function lessonRun(lesson: Lesson, stepIndex: number): PracticeRun {
  const step = lesson.steps[stepIndex];
  return {
    title: `${lesson.title} · ${step.title}`,
    allowBackspace: false,
    assist: true,
    speakOnShow: false,
    showExample: false,
    mono: lesson.id === 'code',
    passAccuracy: lesson.passAccuracy,
    timedMs: null,
    items: step.items,
    source: { type: 'lesson', lessonId: lesson.id, stepIndex },
  };
}

export function warmupKeys(weak: string[]): string[] {
  const use: string[] = [];
  for (const key of [...weak, ...DEFAULT_WARM_KEYS]) {
    const next = key.toLowerCase();
    if (next.length !== 1 || use.includes(next)) continue;
    use.push(next);
    if (use.length >= 4) break;
  }
  return use;
}

export function buildWarmup(keys: string[]): PracticeRun {
  const use = warmupKeys(keys);
  const drills = use.flatMap((key, index) => [
    line(homeReturn(key, 4), { id: `warm-${index}-a`, note: homeReturnNote(key) }),
    line(homeReturn(key, 3), { id: `warm-${index}-b` }),
  ]);
  const words = spellings(
    ['red', 'tree', 'like', 'water', 'apple', 'star', 'bird', 'jump'].filter((spelling) =>
      use.some((key) => spelling.toLowerCase().includes(key.toLowerCase())),
    ),
    'warm',
  );
  return {
    title: '1 分钟热身',
    allowBackspace: false,
    assist: true,
    speakOnShow: false,
    showExample: false,
    mono: false,
    passAccuracy: null,
    timedMs: 60_000,
    items: [...drills, ...words, ...drills],
    source: { type: 'warmup' },
  };
}

export function isLessonUnlocked(
  lessonIndex: number,
  progress: Record<string, { completed: boolean }>,
): boolean {
  if (lessonIndex <= 0) return true;
  const previous = LESSONS[lessonIndex - 1];
  return previous.steps.every((step) => progress[step.id]?.completed);
}

export function lessonComplete(
  lesson: Lesson,
  progress: Record<string, { completed: boolean }>,
): boolean {
  return lesson.steps.every((step) => progress[step.id]?.completed);
}

export function continueTarget(
  progress: Record<string, { completed: boolean }>,
): { lesson: Lesson; stepIndex: number } {
  for (const lesson of LESSONS) {
    const stepIndex = lesson.steps.findIndex((step) => !progress[step.id]?.completed);
    if (stepIndex >= 0) return { lesson, stepIndex };
  }
  const last = LESSONS[LESSONS.length - 1];
  return { lesson: last, stepIndex: last.steps.length - 1 };
}
