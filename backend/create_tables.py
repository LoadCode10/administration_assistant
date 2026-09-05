from database import engine, Base
import models

Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)
Base.metadata.refresh_all(engine)

print("Tables dropped and created successfully!")