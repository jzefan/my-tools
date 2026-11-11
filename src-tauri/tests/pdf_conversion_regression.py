"""Local conversion regressions; all fixtures live in temporary directories.

Run: python3 src-tauri/tests/pdf_conversion_regression.py
Requires existing Python packages: pdf2docx, python-docx, PyMuPDF, Pillow, reportlab.
No office applications, downloads, or user documents are used.
"""
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import fitz
from docx import Document
from PIL import Image
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Image as PdfImage, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

SOURCE = Path(__file__).parents[1] / 'src/pdf_convert.rs'
SCRIPT = SOURCE.read_text().split('fn convert_pdf_to_word_pdf2docx(', 1)[1].split('let script = r#"', 1)[1].split('"#;', 1)[0]

class ConversionRegression(unittest.TestCase):
    def test_toc_image_merged_table_and_order(self):
        with tempfile.TemporaryDirectory(prefix='doc-tools-regression-') as directory:
            directory = Path(directory)
            image = directory / 'image.png'
            Image.new('RGB', (80, 50), (20, 90, 180)).save(image)
            source, output = directory / 'source.pdf', directory / 'output.docx'
            styles = getSampleStyleSheet()
            table = Table([['MERGED', ''], ['LEFT', 'RIGHT']], colWidths=[150, 150])
            table.setStyle(TableStyle([('SPAN', (0, 0), (1, 0)), ('GRID', (0, 0), (-1, -1), 1, (0, 0, 0))]))
            SimpleDocTemplate(str(source)).build([
                Paragraph('Contents .......... 1', styles['Normal']),
                Paragraph('BEFORE', styles['Normal']), table,
                Paragraph('AFTER', styles['Normal']), PdfImage(str(image), 80, 50),
                PageBreak(), Paragraph('PAGE TWO', styles['Normal'])])
            subprocess.run([sys.executable, '-c', SCRIPT, str(source), str(output), '1,2'], check=True, capture_output=True)
            result = Document(output)
            self.assertTrue(result.inline_shapes)
            self.assertTrue(result.tables)
            xml = result.part.element.xml
            self.assertIn('gridSpan', xml)
            self.assertLess(xml.index('BEFORE'), xml.index('<w:tbl>'))
            self.assertLess(xml.index('<w:tbl>'), xml.index('AFTER'))
            self.assertIn('Contents', xml)
            self.assertIn('PAGE TWO', xml)
            subprocess.run([sys.executable, '-c', SCRIPT, str(source), str(output), '2'], check=True, capture_output=True)
            selected = Document(output).part.element.xml
            self.assertIn('PAGE TWO', selected)
            self.assertNotIn('BEFORE', selected)

    def test_multiple_images_table_image_and_two_page_chinese(self):
        pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
        with tempfile.TemporaryDirectory(prefix='doc-tools-multi-cjk-') as directory:
            directory = Path(directory)
            style = getSampleStyleSheet()['Normal']
            style.fontName = 'STSong-Light'
            images = []
            for index, color in enumerate(['red', 'blue', 'green']):
                image = directory / f'image-{index}.png'
                Image.new('RGB', (60 + index * 10, 40), color).save(image)
                images.append(image)
            table = Table([
                [Paragraph('表内图像', style), PdfImage(str(images[1]), 70, 40)],
                [Paragraph('合并单元格', style), ''],
            ], colWidths=[150, 150])
            table.setStyle(TableStyle([
                ('SPAN', (0, 1), (1, 1)),
                ('GRID', (0, 0), (-1, -1), 1, (0, 0, 0)),
            ]))
            source = directory / 'source.pdf'
            output = directory / 'output.docx'
            SimpleDocTemplate(str(source)).build([
                Paragraph('中文目录 .......... 1', style),
                PdfImage(str(images[0]), 60, 40), table,
                PageBreak(), Paragraph('第二页中文正文', style),
                PdfImage(str(images[2]), 80, 40),
            ])
            subprocess.run([
                sys.executable, '-c', SCRIPT, str(source), str(output), '1,2',
            ], check=True, capture_output=True, timeout=60)
            result = Document(output)
            xml = result.part.element.xml
            self.assertEqual(len(result.inline_shapes), 3)
            self.assertIn('中文目录', xml)
            self.assertIn('第二页中文正文', xml)
            self.assertIn('合并单元格', xml)
            self.assertIn('gridSpan', xml)
            self.assertTrue(any(table._element.xpath('.//w:drawing') for table in result.tables))
            self.assertLess(xml.index('中文目录'), xml.index('第二页中文正文'))

    def test_scanned_page_does_not_succeed_blank(self):
        with tempfile.TemporaryDirectory(prefix='doc-tools-scan-') as directory:
            directory = Path(directory)
            png = io.BytesIO()
            Image.new('RGB', (100, 100), (20, 90, 180)).save(png, format='PNG')
            pdf = fitz.open()
            page = pdf.new_page()
            page.insert_image(page.rect, stream=png.getvalue())
            source, output = directory / 'scan.pdf', directory / 'scan.docx'
            pdf.save(source)
            run = subprocess.run([sys.executable, '-c', SCRIPT, str(source), str(output), '1'], capture_output=True)
            if run.returncode == 0:
                self.assertTrue(Document(output).inline_shapes)
            else:
                self.assertIn('图片未保留', run.stderr.decode())

    def test_chinese_pinyin_table_fidelity_and_zero_truncation(self):
        pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
        with tempfile.TemporaryDirectory(prefix='doc-tools-pinyin-') as directory:
            directory = Path(directory)
            source, output = directory / 'pinyin.pdf', directory / 'pinyin.docx'
            style = getSampleStyleSheet()['Normal']
            style.fontName = 'STSong-Light'

            # 类似原图的无边框生字与拼音排版
            data = [
                [Paragraph('第1课', style), Paragraph('食盐(yán)', style), Paragraph('薄雾(bó)', style), Paragraph('隆重(lóng)', style)],
                [Paragraph('', style), Paragraph('浩荡(hào)', style), Paragraph('山崩地裂(bēng)', style), Paragraph('霎时(shà)', style)],
                [Paragraph('第2课', style), Paragraph('半明半昧(mèi)', style), Paragraph('摇摇欲坠(zhuì)', style), Paragraph('萤火虫(yíng)', style)],
            ]
            table = Table(data, colWidths=[80, 100, 130, 100])
            # 无任何边框样式（忠于原文的无框多列对齐）
            table.setStyle(TableStyle([
                ('FONTNAME', (0, 0), (-1, -1), 'STSong-Light'),
            ]))

            SimpleDocTemplate(str(source)).build([
                Paragraph('四年级上册第一单元知识点 - 字音', style),
                table,
            ])

            subprocess.run([sys.executable, '-c', SCRIPT, str(source), str(output), '1'], check=True, capture_output=True, timeout=60)
            result = Document(output)
            self.assertTrue(result.tables)
            docx_tbl = result.tables[0]
            
            # 1. 忠于原文：无边框排版转换后，表格边框全部设为 none，绝不凭空出现多余边框网格线
            from docx.oxml.ns import qn
            tbl_borders = docx_tbl._tbl.tblPr.xpath('./w:tblBorders')
            self.assertTrue(tbl_borders, 'tblBorders 应显式存在以抑制 Word 默认网格')
            for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
                edge_node = tbl_borders[0].find(qn(f'w:{edge}'))
                self.assertIsNotNone(edge_node, f'{edge} 边框节点应存在')
                self.assertEqual(edge_node.get(qn('w:val')), 'none', f'{edge} 边框必须为 none')

            # 2. 彻底杜绝文字截断：行高不得为 exact，必须为 atLeast 自适应撑开
            for row in docx_tbl.rows:
                for th in row._tr.xpath('.//w:trHeight'):
                    self.assertEqual(th.get(qn('w:hRule')), 'atLeast', '行高规则必须为 atLeast，避免文字被腰斩截断')
                # 检查单元格内段落行距不得为 exact 截断
                for cell in row.cells:
                    for sp in cell._tc.xpath('.//w:spacing'):
                        self.assertNotEqual(sp.get(qn('w:lineRule')), 'exact', '单元格内段落行距不得为 exact，防止拼音和汉字被削掉')

            # 3. 验证生字和带声调拼音文本完整保留
            text_xml = result.part.element.xml
            self.assertIn('食盐', text_xml)
            self.assertIn('山崩地裂', text_xml)
            self.assertIn('摇摇欲坠', text_xml)

    def test_bordered_table_retains_borders(self):
        with tempfile.TemporaryDirectory(prefix='doc-tools-bordered-') as directory:
            directory = Path(directory)
            source, output = directory / 'bordered.pdf', directory / 'bordered.docx'
            styles = getSampleStyleSheet()
            table = Table([['A1', 'B1'], ['A2', 'B2']], colWidths=[100, 100])
            table.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 1, (0, 0, 0))]))
            SimpleDocTemplate(str(source)).build([table])

            subprocess.run([sys.executable, '-c', SCRIPT, str(source), str(output), '1'], check=True, capture_output=True, timeout=60)
            result = Document(output)
            all_tbls = result.element.body.xpath('.//w:tbl')
            self.assertTrue(all_tbls)
            from docx.oxml.ns import qn
            # 找到含有 A1 的数据表格
            data_tbl = next(tbl for tbl in all_tbls if 'A1' in tbl.xml)
            # 真实边框表格保留边框，单元格边框不为 none
            cell_borders = data_tbl.xpath('./w:tr/w:tc/w:tcPr/w:tcBorders/*')
            self.assertTrue(cell_borders, '带框表格应保留单元格边框')
            for b in cell_borders:
                val = b.get(qn('w:val'))
                if val:
                    self.assertNotEqual(val.lower(), 'none')

    def test_tagged_quote_uses_one_shaded_paragraph(self):
        with tempfile.TemporaryDirectory(prefix='doc-tools-quote-') as directory:
            source, output = Path(directory) / 'quote.pdf', Path(directory) / 'output.docx'
            with fitz.open() as pdf:
                page = pdf.new_page()
                page.insert_text((50, 80), 'Chapter heading', fontsize=21)
                page.draw_rect(fitz.Rect(50, 99, 545, 100.5), color=None, fill=(0.2, 0.2, 0.2))
                page.draw_rect(fitz.Rect(50, 119, 545, 193), color=None, fill=(0.96, 0.96, 0.95))
                page.draw_rect(fitz.Rect(50, 119, 52, 193), color=None, fill=(0.6, 0.6, 0.6))
                page.insert_text((66, 145), 'A quotation can span more than one line.', fontsize=12)
                page.insert_text((66, 167), 'This line is part of the same quotation.', fontsize=12)
                page.insert_text((50, 225), 'Following paragraph', fontsize=12)
                page.draw_rect(fitz.Rect(50, 260, 210, 310))
                page.draw_line((50, 285), (210, 285))
                page.insert_text((60, 278), 'Table row one', fontsize=12)
                page.insert_text((60, 303), 'Table row two', fontsize=12)

                # Mark both text lines as children of a single PDF BlockQuote.
                heading, _, _, _, first, second, following = page.get_contents()[:7]
                for stream, mcid in [(heading, 0), (first, 1), (second, 2), (following, 3)]:
                    pdf.update_stream(stream, f'/P <</MCID {mcid}>> BDC\n'.encode()
                                      + pdf.xref_stream(stream) + b'\nEMC\n')
                root, structure, before, quote, body, after, tree = [pdf.get_new_xref() for _ in range(7)]
                page_ref = f'/Pg {page.xref} 0 R'
                for ref, value in [
                    (root, f'/Type /StructTreeRoot /K {structure} 0 R /ParentTree {tree} 0 R'),
                    (structure, f'/S /Document /P {root} 0 R /K [{before} 0 R {quote} 0 R {after} 0 R]'),
                    (before, f'/S /P /P {structure} 0 R {page_ref} /K 0'),
                    (quote, f'/S /BlockQuote /P {structure} 0 R {page_ref} /K {body} 0 R'),
                    (body, f'/S /P /P {quote} 0 R {page_ref} /K [1 2]'),
                    (after, f'/S /P /P {structure} 0 R {page_ref} /K 3'),
                    (tree, f'/Nums [0 [{before} 0 R {body} 0 R {body} 0 R {after} 0 R]]'),
                ]:
                    pdf.update_object(ref, f'<< {value} >>')
                pdf.xref_set_key(pdf.pdf_catalog(), 'StructTreeRoot', f'{root} 0 R')
                pdf.xref_set_key(pdf.pdf_catalog(), 'MarkInfo', '<< /Marked true >>')
                pdf.xref_set_key(page.xref, 'StructParents', '0')
                pdf.save(source)

            subprocess.run([sys.executable, '-c', SCRIPT, str(source), str(output), '1'],
                           check=True, capture_output=True, timeout=60)
            docx = Document(output)
            self.assertEqual(len(docx.tables), 1)
            self.assertEqual([row.cells[0].text for row in docx.tables[0].rows],
                             ['Table row one', 'Table row two'])
            quote = next(p for p in docx.paragraphs if p.style.name == 'Quote')
            self.assertEqual(quote.text, 'A quotation can span more than one line.\n'
                                         'This line is part of the same quotation.')
            self.assertTrue(quote._p.xpath('./w:pPr/w:shd'))
            self.assertTrue(quote._p.xpath('./w:pPr/w:pBdr/w:left'))
            self.assertTrue(quote._p.getprevious().xpath('./w:pPr/w:pBdr/w:bottom'))
            self.assertIn('Following paragraph', [p.text for p in docx.paragraphs])

    def test_vector_outlined_1to1_anchor_fidelity(self):
        with tempfile.TemporaryDirectory(prefix='doc-tools-vector-') as directory:
            directory = Path(directory)
            source, output = directory / 'vector.pdf', directory / 'vector.docx'
            doc = fitz.open()
            for _ in range(2):
                p = doc.new_page(width=595, height=842)
                for i in range(120):
                    shape = p.new_shape()
                    shape.draw_rect(fitz.Rect(10 + i, 10 + i, 20 + i, 20 + i))
                    shape.finish(fill=(0.2, 0.4, 0.8))
                    shape.commit()
                p.insert_text(fitz.Point(100, 100), 'X')
            doc.save(source)
            doc.close()

            subprocess.run([sys.executable, '-c', SCRIPT, str(source), str(output), 'all'], check=True, capture_output=True, timeout=60)
            result = Document(output)

            # 1. 验证生成真实原生可编辑段落（拒绝整页图片背景截图）
            all_text = ''.join(p.text for p in result.paragraphs)
            self.assertIn('X', all_text, '转曲/矢量页面必须输出可编辑真实文本')

            # 2. 验证不含全页截图背景图 (wp:anchor behindDoc)
            behind_doc_anchors = result.element.body.xpath('.//wp:anchor[@behindDoc="1"]')
            self.assertEqual(len(behind_doc_anchors), 0, '禁止将整页作为背景图片嵌入，必须保证文本原生可编辑')

            # 3. 验证无 exact 行高截断
            exact_spacings = result.element.body.xpath('.//w:spacing[@w:lineRule="exact"]')
            self.assertEqual(len(exact_spacings), 0, '段落不应有 exact 行高截断')

    def test_illustrated_outlined_page_is_deferred_to_builtin_engine(self):
        with tempfile.TemporaryDirectory(prefix='doc-tools-illustrated-vector-') as directory:
            source = Path(directory) / 'illustrated.pdf'
            output = Path(directory) / 'output.docx'
            image = io.BytesIO()
            Image.new('RGB', (16, 16), 'blue').save(image, format='PNG')
            with fitz.open() as pdf:
                page = pdf.new_page()
                for index in range(120):
                    page.draw_rect(fitz.Rect(index, index, index + 5, index + 5), fill=(0, 0, 0))
                page.insert_image(fitz.Rect(40, 40, 80, 80), stream=image.getvalue())
                pdf.save(source)
            run = subprocess.run([sys.executable, '-c', SCRIPT, str(source), str(output), '1'],
                                 capture_output=True, text=True, timeout=30)
            self.assertNotEqual(run.returncode, 0)
            self.assertIn('OCR 排版无法保留原页图片', run.stderr)
            self.assertFalse(output.exists())

if __name__ == '__main__':
    unittest.main()
