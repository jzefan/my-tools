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

if __name__ == '__main__':
    unittest.main()
