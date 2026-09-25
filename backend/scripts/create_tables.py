import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, Base
import models as models

Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)
print("Tables dropped and created successfully!")