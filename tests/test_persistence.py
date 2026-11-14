import tempfile
import unittest
from pathlib import Path

from omnigrid.train import initialize_data_dir


class PersistenceTests(unittest.TestCase):
    def test_initializes_missing_files_without_overwriting_persisted_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            target = root / "target"
            source.mkdir()
            (source / "qtable.json").write_text('{"episodes": 7}')
            (source / "learning_curve.json").write_text('[{"episode":7}]')

            initialize_data_dir(target, source)

            self.assertEqual((target / "qtable.json").read_text(), '{"episodes": 7}')
            self.assertEqual((target / "learning_curve.json").read_text(), '[{"episode":7}]')

            (target / "qtable.json").write_text('{"episodes": 8}')
            initialize_data_dir(target, source)
            self.assertEqual((target / "qtable.json").read_text(), '{"episodes": 8}')


if __name__ == "__main__":
    unittest.main()
