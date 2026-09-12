from database import engine, Base
import models as models

# Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)
print("Tables dropped and created successfully!")