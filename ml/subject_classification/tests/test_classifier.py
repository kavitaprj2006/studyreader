"""
Unit Tests for Python Academic Subject Classifier Module.
"""

import os
import unittest
import sys

# Ensure src is importable
src_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
sys.path.insert(0, src_dir)

from preprocess import clean_text
from predict import SubjectPredictor

class TestSubjectClassifier(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.predictor = SubjectPredictor()

    def test_clean_text_normalizes_and_removes_stopwords(self):
        raw = "What is the primary key in a relational database management system (DBMS)?"
        cleaned = clean_text(raw)
        tokens = cleaned.split()
        self.assertNotIn("what", tokens)
        self.assertNotIn("is", tokens)
        self.assertNotIn("the", tokens)
        self.assertNotIn("in", tokens)
        self.assertNotIn("a", tokens)
        self.assertIn("primary", tokens)
        self.assertIn("key", tokens)
        self.assertIn("database", tokens)
        self.assertIn("dbms", tokens)

    def test_clean_text_handles_urls_and_special_chars(self):
        raw = "Check http://example.com/notes on E-R diagrams & SQL: SELECT * FROM users;"
        cleaned = clean_text(raw)
        self.assertNotIn("http", cleaned)
        self.assertNotIn("example", cleaned)
        self.assertIn("diagrams", cleaned)
        self.assertIn("sql", cleaned)

    def test_dbms_prediction(self):
        text = "Database normalization into 3NF and BCNF ensures lack of insertion anomalies and preserves functional dependencies in SQL tables."
        res = self.predictor.predict(text)
        self.assertEqual(res["predicted_subject"], "Database Management Systems")
        self.assertGreater(res["confidence"], 0.15)

    def test_physics_prediction(self):
        text = "According to Newton's second law of motion, the force acting on an object equals mass times acceleration F = ma with kinetic friction."
        res = self.predictor.predict(text)
        self.assertEqual(res["predicted_subject"], "Physics")
        self.assertGreater(res["confidence"], 0.15)

    def test_biology_prediction(self):
        text = "During photosynthesis, chloroplast thylakoid membranes convert solar energy into ATP and NADPH to fuel the dark reactions."
        res = self.predictor.predict(text)
        self.assertEqual(res["predicted_subject"], "Biology")
        self.assertGreater(res["confidence"], 0.15)

    def test_dsa_prediction(self):
        text = "Binary search tree with AVL balancing rotations maintains O(log n) time complexity for search, insertion, and deletion operations."
        res = self.predictor.predict(text)
        self.assertEqual(res["predicted_subject"], "Data Structures & Algorithms")
        self.assertGreater(res["confidence"], 0.15)

    def test_empty_or_nonsense_text_does_not_crash(self):
        res1 = self.predictor.predict("")
        self.assertIn(res1["status"], ["unclassified", "needs_review"])

        res2 = self.predictor.predict("xyz 123 !@#")
        self.assertIn(res2["status"], ["unclassified", "needs_review"])

if __name__ == "__main__":
    unittest.main()
