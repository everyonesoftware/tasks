import unittest
from datetime import date


class ScheduleTests(unittest.TestCase):
    def test_daily_latest_and_next_are_anchored_without_backlog(self):
        from services.server.schedule import around
        self.assertEqual(around(date(2026, 1, 1), 'daily', 3, date(2026, 1, 11)),
                         (date(2026, 1, 10), date(2026, 1, 13)))

    def test_once_and_weekly_include_start_and_stop_once(self):
        from services.server.schedule import around
        start = date(2026, 1, 1)
        self.assertEqual(around(start, 'once', 1, date(2025, 12, 31)), (None, start))
        self.assertEqual(around(start, 'once', 1, date(2026, 3, 1)), (start, None))
        self.assertEqual(around(start, 'weekly', 2, date(2026, 1, 15)),
                         (date(2026, 1, 15), date(2026, 1, 29)))

    def test_monthly_and_yearly_clamp_but_retain_anchor(self):
        from services.server.schedule import around
        cases = [
            (date(2025, 1, 31), 'monthly', 1, date(2025, 2, 28), (date(2025, 2, 28), date(2025, 3, 31))),
            (date(2025, 1, 31), 'monthly', 2, date(2025, 4, 1), (date(2025, 3, 31), date(2025, 5, 31))),
            (date(2024, 2, 29), 'yearly', 1, date(2027, 3, 1), (date(2027, 2, 28), date(2028, 2, 29))),
            (date(2024, 2, 29), 'yearly', 4, date(2028, 2, 28), (date(2024, 2, 29), date(2028, 2, 29))),
            (date(2025, 1, 31), 'monthly', 1, date(2025, 3, 1), (date(2025, 2, 28), date(2025, 3, 31))),
        ]
        for start, repeat, interval, on, expected in cases:
            with self.subTest(start=start, repeat=repeat, on=on):
                self.assertEqual(around(start, repeat, interval, on), expected)


if __name__ == '__main__':
    unittest.main()
