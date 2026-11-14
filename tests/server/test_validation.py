import unittest


class ValidationTests(unittest.TestCase):
    def test_task_defaults_and_trimmed_title(self):
        from services.server.validation import task_fields
        self.assertEqual(task_fields({'title': '  Buy milk  ', 'startDate': '2026-11-14'}), {
            'title': 'Buy milk', 'startDate': '2026-11-14', 'notes': '', 'category': 'Personal',
            'repeat': 'once', 'interval': 1, 'priority': 0})

    def test_title_length_applies_after_trimming(self):
        from services.server.validation import task_fields
        task = task_fields({'title':' ' + 'x'*200 + ' ', 'startDate':'2026-11-14'})
        self.assertEqual(task['title'], 'x'*200)

    def test_rejects_unpaired_surrogates_in_all_task_text(self):
        from services.server.validation import task_fields, APIError
        for field in ('title', 'notes', 'category', 'repeat', 'startDate'):
            with self.subTest(field=field), self.assertRaises(APIError) as caught:
                task_fields({'title':'Valid', 'startDate':'2026-11-14', field:'\ud800'})
            self.assertEqual(caught.exception.status, 400)
        self.assertEqual(task_fields({'title':'Valid 😀','startDate':'2026-11-14'})['title'], 'Valid 😀')

    def test_rejects_malformed_dates_and_task_fields(self):
        from services.server.validation import task_fields, iso_date, APIError
        for value in ('2026-02-29', '2026-1-01', '0000-01-01', '10000-01-01', '20261114', '2026-W01-1', '1'*70000, None, 123, True):
            with self.subTest(date=repr(value)[:30]), self.assertRaises(APIError):
                iso_date(value)
        bad = [[], None, {'title': ''}, {'title': ' '*5}, {'title': 'x'*201}, {'notes': 'x'*2001},
               {'category': 'x'*61}, {'title': 1}, {'notes': None}, {'title': 'x\x00'},
               {'repeat': []}, {'repeat': 'sometimes'}, {'interval': True}, {'interval': 0},
               {'interval': 366}, {'priority': 3}, {'priority': 1.0}, {'unknown': 1}]
        for fields in bad:
            value = {'title': 'Valid', 'startDate': '2026-11-14'}
            if isinstance(fields, dict):
                value.update(fields)
            else:
                value = fields
            with self.subTest(fields=repr(fields)[:30]), self.assertRaises(APIError):
                task_fields(value)
