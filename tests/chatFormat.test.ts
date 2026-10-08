import { describe, expect, it } from 'vitest';
import { formatChat, hideComments, mediaKind, youtubeId } from '@/lib/chatFormat';

describe('hideComments', () => {
  it('leaves out <!-- comments -->, and the lines they leave empty', () => {
    expect(hideComments('Hello <!-- be terse --> there.')).toBe('Hello  there.');
    expect(hideComments('*waves*\n<!-- Notes for the model:\nkeep it slow -->\n"Hi."')).toBe('*waves*\n"Hi."');
    expect(hideComments('<!-- a -->\n\nText\n\n<!-- b -->\n\nMore')).toBe('Text\n\nMore');
    expect(hideComments('No comments here.')).toBe('No comments here.');
  });

  it('hides one still being written to the end', () => {
    expect(hideComments('Hi. <!-- still wri')).toBe('Hi.');
  });
});

describe('formatChat', () => {
  it('styles actions, bold and speech', () => {
    expect(formatChat('*waves* "Hi!" **really**')).toEqual([
      { kind: 'em', children: ['waves'] },
      ' ',
      { kind: 'quote', children: ['"Hi!"'] },
      ' ',
      { kind: 'strong', children: ['really'] },
    ]);
  });

  it('renders italics inside speech', () => {
    expect(formatChat('"We really, *really* owe you one."')).toEqual([
      { kind: 'quote', children: ['"We really, ', { kind: 'em', children: ['really'] }, ' owe you one."'] },
    ]);
  });

  it('renders speech inside italics', () => {
    expect(formatChat('*she whispers "hello" and leaves*')).toEqual([
      { kind: 'em', children: ['she whispers ', { kind: 'quote', children: ['"hello"'] }, ' and leaves'] },
    ]);
  });

  it('handles curly quotes and underscores, but not snake_case', () => {
    expect(formatChat('“Yes,” she said. _Sure._ my_var')).toEqual([
      { kind: 'quote', children: ['“Yes,”'] },
      ' she said. ',
      { kind: 'em', children: ['Sure.'] },
      ' my_var',
    ]);
  });

  it("doesn't span lines or pair a lone marker", () => {
    expect(formatChat('a *b\nc* d')).toEqual(['a *b\nc* d']);
    expect(formatChat('5 * 3 = 15 "unclosed')).toEqual(['5 * 3 = 15 "unclosed']);
  });

  it('shows embedded pictures, markdown or HTML', () => {
    expect(formatChat('Hi ![Edith waving](https://example.com/a.png "title") there')).toEqual([
      'Hi ',
      { kind: 'image', src: 'https://example.com/a.png', alt: 'Edith waving' },
      ' there',
    ]);
    expect(formatChat('<img src="https://example.com/b.webp" alt="b" width="300">')).toEqual([{ kind: 'image', src: 'https://example.com/b.webp', alt: 'b' }]);
    expect(formatChat("<IMG alt='c' src='https://example.com/c.png'/>")).toEqual([{ kind: 'image', src: 'https://example.com/c.png', alt: 'c' }]);
  });

  it('shows pictures inside speech and italics', () => {
    expect(formatChat('*holds up ![](https://example.com/p.png)*')).toEqual([{ kind: 'em', children: ['holds up ', { kind: 'image', src: 'https://example.com/p.png', alt: '' }] }]);
  });

  it('leaves anything but web and inline pictures as text', () => {
    expect(formatChat('![x](javascript:alert(1))')).toEqual(['![x](javascript:alert(1))']);
    expect(formatChat('<img src="file:///etc/passwd">')).toEqual(['<img src="file:///etc/passwd">']);
    expect(formatChat('![x](images/a.png) !not an image')).toEqual(['![x](images/a.png) !not an image']);
  });
});

describe('headings', () => {
  it('shows # to ###### at the start of a line as headings, taking the line break with them', () => {
    expect(formatChat('# Day one\nShe waits.')).toEqual([{ kind: 'heading', level: 1, children: ['Day one'] }, 'She waits.']);
    expect(formatChat('Before.\n### *Chapter* two ##\nAfter.')).toEqual([
      'Before.\n',
      { kind: 'heading', level: 3, children: [{ kind: 'em', children: ['Chapter'] }, ' two'] },
      'After.',
    ]);
    expect(formatChat('  ###### Small')).toEqual([{ kind: 'heading', level: 6, children: ['Small'] }]);
  });

  it('leaves hashtags, sevens and mid-line #s alone', () => {
    expect(formatChat('#tag and #another')).toEqual(['#tag and #another']);
    expect(formatChat('####### Too many')).toEqual(['####### Too many']);
    expect(formatChat('Score: # 1')).toEqual(['Score: # 1']);
    expect(formatChat('#')).toEqual(['#']);
  });
});

describe('code', () => {
  it('shows `inline code` as written, styling characters and all', () => {
    expect(formatChat('Type `rm -rf *tmp*` to clean up.')).toEqual(['Type ', { kind: 'code', text: 'rm -rf *tmp*' }, ' to clean up.']);
    expect(formatChat('``a `tick` inside``')).toEqual([{ kind: 'code', text: 'a `tick` inside' }]);
    expect(formatChat('` `` `')).toEqual([{ kind: 'code', text: '``' }]);
    // Inside speech or actions too.
    expect(formatChat('*She types `ls` quietly.*')).toEqual([{ kind: 'em', children: ['She types ', { kind: 'code', text: 'ls' }, ' quietly.'] }]);
  });

  it('shows a fenced block as written, across lines, with its language', () => {
    expect(formatChat('Look:\n```js\nconst a = "*b*";\n\nlog(a);\n```\nDone.')).toEqual([
      'Look:\n',
      { kind: 'codeBlock', text: 'const a = "*b*";\n\nlog(a);', lang: 'js' },
      'Done.',
    ]);
    expect(formatChat('~~~\nplain\n~~~')).toEqual([{ kind: 'codeBlock', text: 'plain' }]);
    expect(formatChat('```\n```')).toEqual([{ kind: 'codeBlock', text: '' }]);
  });

  it('runs a block still being written to the end', () => {
    expect(formatChat('```py\nprint(1)\nprint(')).toEqual([{ kind: 'codeBlock', text: 'print(1)\nprint(', lang: 'py' }]);
  });

  it('leaves a lone backtick, and a fence mid-line, alone', () => {
    expect(formatChat("It's 5` tall.")).toEqual(["It's 5` tall."]);
    expect(formatChat('Say ```hi``` now')).toEqual(['Say ', { kind: 'code', text: 'hi' }, ' now']);
  });
});

describe('rules', () => {
  it('shows ---, *** and ___ alone on a line, and <hr>, as a rule', () => {
    expect(formatChat('Act one.\n---\nAct two.')).toEqual(['Act one.\n', { kind: 'rule' }, 'Act two.']);
    expect(formatChat('* * *')).toEqual([{ kind: 'rule' }]);
    expect(formatChat('a<hr>b')).toEqual(['a', { kind: 'rule' }, 'b']);
  });

  it('leaves dashes in a sentence, and bold, alone', () => {
    expect(formatChat('Wait -- no --- stop.')).toEqual(['Wait -- no --- stop.']);
    expect(formatChat('**bold**')).toEqual([{ kind: 'strong', children: ['bold'] }]);
    expect(formatChat('--')).toEqual(['--']);
  });
});

describe('links and media', () => {
  it('makes [text](url) and bare addresses links, web ones only', () => {
    expect(formatChat('Hear [the *song*](https://example.com/a) now')).toEqual(['Hear ', { kind: 'link', href: 'https://example.com/a', children: ['the ', { kind: 'em', children: ['song'] }] }, ' now']);
    expect(formatChat('See https://example.com/x_y.')).toEqual(['See ', { kind: 'link', href: 'https://example.com/x_y', children: ['https://example.com/x_y'] }, '.']);
    expect(formatChat('[no](javascript:alert(1))')).toEqual(['[no](javascript:alert(1))']);
    expect(formatChat('ahttps://x.y')).toEqual(['ahttps://x.y']);
  });

  it('plays <audio> and <video> tags, as Chub cards write them', () => {
    expect(formatChat('Intro\n<audio controls=""><source type="audio/mpeg" src="https://files.catbox.moe/ffytyf.mp3"></audio>\n\nDawn.')).toEqual([
      'Intro\n',
      { kind: 'media', media: 'audio', src: 'https://files.catbox.moe/ffytyf.mp3', type: 'audio/mpeg' },
      '\nDawn.',
    ]);
    expect(formatChat('<video controls src="https://x.y/clip.webm"></video>')).toEqual([{ kind: 'media', media: 'video', src: 'https://x.y/clip.webm' }]);
    // Nothing playable (or not from the web): left as written.
    expect(formatChat('<audio src="file:///x.mp3"></audio>')).toEqual(['<audio src="file:///x.mp3"></audio>']);
  });

  it('plays links straight to a sound or video file', () => {
    expect(formatChat('[Theme](https://x.y/theme.mp3?dl=1)')).toEqual([{ kind: 'media', media: 'audio', src: 'https://x.y/theme.mp3?dl=1', label: 'Theme' }]);
    expect(formatChat('https://x.y/a.mp4')).toEqual([{ kind: 'media', media: 'video', src: 'https://x.y/a.mp4' }]);
    expect(mediaKind('https://mp3.example.com/page')).toBeNull();
  });

  it('knows a YouTube link from its forms', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=ftFTm7ElIns')).toBe('ftFTm7ElIns');
    expect(youtubeId('https://youtu.be/ftFTm7ElIns?t=3')).toBe('ftFTm7ElIns');
    expect(youtubeId('https://youtube.com/watch?list=x&v=ftFTm7ElIns')).toBe('ftFTm7ElIns');
    expect(youtubeId('https://notyoutube.com/watch?v=ftFTm7ElIns')).toBeNull();
  });
});
