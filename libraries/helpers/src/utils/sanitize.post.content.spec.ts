import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { stripHtmlValidation } from './strip.html.validation';
import { parseFragment, serialize } from 'parse5';
import {
  CreatePostDto,
  Post,
  PostContent,
} from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  postContentPlainText,
  sanitizePostContent,
} from './sanitize.post.content';

// Verbatim sections from cluster-brevetabilite/articles-json/A1-nouveaute-brevet.json.
// Keep representative source here so the suite also runs without the external corpus.
const article = `<h2>Étape 1 : décomposer la revendication en caractéristiques vérifiables</h2>
<blockquote>
<p>Dispositif comprenant un capteur, une unité de traitement configurée pour corriger le signal selon une valeur de référence, et un module de commande qui déclenche une action lorsque le signal corrigé dépasse un seuil.</p>
</blockquote>
<ol>
<li>un dispositif comprenant un capteur ;</li>
<li>une unité de traitement configurée pour corriger le signal selon une valeur de référence ;</li>
<li>un module de commande qui déclenche une action lorsque le signal corrigé dépasse un seuil.</li>
</ol>
<table>
<thead>
<tr>
<th>Élément</th>
<th>Question à documenter</th>
</tr>
</thead>
<tbody>
<tr>
<td>Date</td>
<td>Quand la divulgation est-elle devenue accessible ?</td>
</tr>
<tr>
<td>Accessibilité</td>
<td>Le public pouvait-il réellement en prendre connaissance ?</td>
</tr>
<tr>
<td>Contenu</td>
<td>Quel enseignement technique la source transmet-elle ?</td>
</tr>
<tr>
<td>Version</td>
<td>La version examinée correspond-elle à celle qui était disponible à la date pertinente ?</td>
</tr>
</tbody>
</table>
<p>Pour la méthode de collecte et ses limites, voir l'analyse consacrée à la <a href="/articles/recherche-anteriorites">recherche d'antériorités</a>.</p>`;

const transform = (
  contents: string[],
  implicit = false
): Promise<CreatePostDto> =>
  new ValidationPipe({
    transform: true,
    ...(implicit
      ? {
          skipMissingProperties: false,
          transformOptions: { enableImplicitConversion: true },
        }
      : {}),
  }).transform(
    {
      type: 'draft',
      shortLink: false,
      date: '2026-10-20T17:00:00.000Z',
      tags: [],
      posts: contents.map((content) => ({
        type: 'draft',
        integration: { id: 'article-channel' },
        settings: {},
        value: [
          { content, image: [] },
          { content, image: [] },
        ],
      })),
    },
    { type: 'body', metatype: CreatePostDto }
  );

const canonical = (html: string) => serialize(parseFragment(html));

// Opt in to the full local corpus without making CI depend on an external checkout.
const corpusDirectory = process.env.POSTIZ_ARTICLE_CORPUS;
(corpusDirectory ? describe : describe.skip)(
  'external article corpus fidelity',
  () => {
    it('preserves every article through both real create validation pipelines', async () => {
      const files = readdirSync(corpusDirectory!).filter((file) =>
        file.endsWith('.json')
      );
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const { post_content: html } = JSON.parse(
          readFileSync(join(corpusDirectory!, file), 'utf8')
        );
        expect(typeof html).toBe('string');
        for (const implicit of [false, true]) {
          const dto = await transform([html], implicit);
          for (const item of dto.posts[0].value) {
            expect({ file, html: canonical(item.content) }).toEqual({
              file,
              html: canonical(html),
            });
            expect(sanitizePostContent(item.content)).toBe(item.content);
            expect(
              canonical(
                stripHtmlValidation(
                  'html',
                  item.content,
                  true,
                  false,
                  false,
                  undefined,
                  true
                )
              )
            ).toBe(canonical(html));
          }
        }
      }
    });
  }
);

describe('safe rich post content through CreatePostDto', () => {
  it.each([false, true])(
    'preserves article structure in nested items (implicit conversion: %s)',
    async (implicit) => {
      const semantic =
        '<h4>Cas particulier</h4><h5>Détail</h5><h6>Source</h6><p><em>Article 54</em></p>' +
        '<table><caption>Comparaison</caption><thead><tr><th>Critère</th></tr></thead><tbody><tr><td>Établi</td></tr></tbody><tfoot><tr><td>Conclusion</td></tr></tfoot></table>';
      const dto = await transform([article, semantic], implicit);
      expect(dto).toBeInstanceOf(CreatePostDto);
      dto.posts.forEach((post, index) => {
        expect(post).toBeInstanceOf(Post);
        post.value.forEach((item) => {
          expect(item).toBeInstanceOf(PostContent);
          expect(item.content).toBe(canonical([article, semantic][index]));
          // Public review renders this sanitized HTML, including a second sanitize.
          expect(sanitizePostContent(item.content)).toBe(item.content);
          expect(canonical(item.content)).toBe(item.content);
          expect(
            canonical(
              stripHtmlValidation(
                'html',
                item.content,
                true,
                false,
                false,
                undefined,
                true
              )
            )
          ).toBe(canonical([article, semantic][index]));
        });
      });
    }
  );

  it.each([
    '<table onclick="alert(1)"><tbody><tr><td onmouseover="alert(1)">safe<script>alert(1)</script></td></tr></tbody></table>',
    '<h4 style="background:url(javascript:alert(1))" onfocus="alert(1)">safe</h4><iframe src="https://evil.test"></iframe><object data="https://evil.test"></object>',
    '<blockquote><a href="jav&#x61;script:alert(1)">safe</a><a href="java\nscript:alert(1)">link</a><a href="vbscript:msgbox(1)">link</a></blockquote>',
    '<ol><li><a href="data:text/html,<script>alert(1)</script>">safe</a><img src="data:image/svg+xml,<svg onload=alert(1)>"><img src="javascript:alert(1)"></li></ol>',
    '<table><tbody><tr><td><svg><a xlink:href="javascript:alert(1)">bad</a></svg><math><mtext><img src=x onerror=alert(1)></mtext></math>safe</td></tr></tbody></table>',
    '<p>safe</p><math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">',
    '<table><caption><a href="javascript:alert(1)">safe</a></caption><tbody><tr><td><form><input name="__proto__"></form><style>body{display:none}</style></td></tr></tbody></table>',
  ])('removes active content from rich HTML: %s', async (payload) => {
    const dto = await transform([payload]);
    const output = dto.posts[0].value[0].content;
    expect(output).toContain('safe');
    // Inspect the reparsed DOM, the same boundary used by HTML renderers.
    const inspect = (node: any) => {
      expect([
        'script',
        'style',
        'iframe',
        'object',
        'embed',
        'svg',
        'math',
        'form',
        'input',
      ]).not.toContain(node.tagName);
      for (const attr of node.attrs || []) {
        expect(attr.name).not.toMatch(/^(on|style$|srcdoc$|xlink:)/i);
        if (['href', 'src'].includes(attr.name)) {
          expect(attr.value).toMatch(/^(?:https?:|mailto:|\/|#)/i);
        }
      }
      (node.childNodes || []).forEach(inspect);
    };
    inspect(parseFragment(output));
    const published = stripHtmlValidation(
      'html',
      output,
      true,
      false,
      false,
      undefined,
      true
    );
    inspect(parseFragment(published));
    expect(sanitizePostContent(published)).toBe(published);
    expect(sanitizePostContent(output)).toBe(output);
  });

  it.each([
    '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    '<p>&amp;lt;svg onload=alert(1)&amp;gt;</p>',
    '<p><a href="https://example.test/?q=&quot; onmouseover=&quot;alert(1)">source &amp; texte</a></p>',
  ])(
    'never activates encoded markup or attribute quotes while publishing %s',
    async (html) => {
      const dto = await transform([html]);
      const content = dto.posts[0].value[0].content;
      const published = stripHtmlValidation(
        'html',
        content,
        true,
        false,
        false,
        undefined,
        true
      );
      expect(published).toBe(content);
      expect(sanitizePostContent(published)).toBe(published);
      expect(postContentPlainText(published)).toBe(
        postContentPlainText(content)
      );
    }
  );

  it('keeps inline image opt-in and mention conversion in HTML publishing', () => {
    const html =
      '<p><span data-mention-id="123">Alice</span><img src="https://example.test/a.jpg" alt="Photo"></p>';
    expect(
      stripHtmlValidation(
        'html',
        html,
        true,
        false,
        false,
        () => '@Alice',
        true
      )
    ).toBe('<p>@Alice<img src="https://example.test/a.jpg" alt="Photo"></p>');
    expect(
      stripHtmlValidation('html', html, true, false, false, () => '@Alice')
    ).toBe('<p>@Alice</p>');
  });

  it.each(['none', 'normal', 'markdown'] as const)(
    'does not leak new semantic tags into %s output',
    (mode) => {
      const html =
        '<h4>Heading</h4><blockquote>Quote</blockquote><table><tbody><tr><td>Cell</td></tr></tbody></table><ol><li>Item</li></ol><em>Emphasis</em>';
      const result = stripHtmlValidation(mode, html, true);
      expect(result).not.toMatch(
        /<\/?(?:h[4-6]|blockquote|table|tbody|tr|td|ol|em)[\s>]/i
      );
      expect(result).toContain('Heading');
      expect(result).toContain('Cell');
      expect(result).toContain('Emphasis');
      expect(
        stripHtmlValidation(
          mode,
          'Plain text\nwith punctuation & symbols',
          true
        )
      ).toBe(
        mode === 'normal'
          ? 'Plain text\nwith punctuation &amp; symbols'
          : 'Plain text\nwith punctuation & symbols'
      );
    }
  );

  it('keeps existing text, mentions, links and HTTP image behavior', async () => {
    const existing =
      '<p dir="auto">Bonjour <strong>brevet</strong> <u>utile</u><br>' +
      '<span class="mention" data-mention-id="123" data-mention-label="Alice">@Alice</span>' +
      '<a href="https://example.test/path">source</a><a href="mailto:hello@example.test">mail</a>' +
      '<a href="/articles/source">local</a><a href="#source">anchor</a>' +
      '<img src="https://example.test/photo.jpg" alt="Photo"></p>';
    const text = 'Bonjour brevet\nDeuxième ligne : 2 < 3 & 5 > 4, été 😀';
    const dto = await transform([existing, text]);
    // Existing URI rules also remove dir="auto". Do not broaden attributes here.
    expect(dto.posts[0].value[0].content).toBe(
      existing.replace(' dir="auto"', '')
    );
    expect(postContentPlainText(existing)).toBe(
      'Bonjour brevet utile@Alicesourcemaillocalanchor'
    );
    expect(postContentPlainText(dto.posts[1].value[0].content)).toBe(text);
    expect(dto.posts[1].value[0].content).toBe(sanitizePostContent(text));
    expect(
      sanitizePostContent(
        '<img src="/relative.png"><img src="blob:example"><img src="file:///etc/passwd">'
      )
    ).toBe('');
  });

  it('keeps text-node offset semantics without inserting separators for new blocks', () => {
    expect(
      postContentPlainText(
        '<h4>A &amp; B</h4><blockquote>C</blockquote><table><tbody><tr><td>D</td><td>E</td></tr></tbody></table><ol><li>F</li></ol>'
      )
    ).toBe('A & BCDEF');
  });

  it.each([undefined, null, 42, {}, ''])(
    'normalizes empty or non-string helper input %p',
    (input) => {
      expect(sanitizePostContent(input)).toBe('');
      expect(postContentPlainText(input)).toBe('');
    }
  );

  it('still rejects empty or script-only posts without media', async () => {
    await expect(transform([''])).rejects.toThrow();
    await expect(transform(['<script>alert(1)</script>'])).rejects.toThrow();
  });
});
