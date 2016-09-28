### Space counting service

Space counting service should be a resource that lives in one thread, allowing mail and storage resources and processes to talk to it.
Sometime it has to calculate actual use of space by user.
Sometime it should calculate system's free space.
Using this estimates, it does calculations, based on provided to it information about use of space.

Such service can be turn on in app.ts.
When things will change to cluster setting, resource should stay in master, while workers should get corresponding other side.

Notice that mail and storage recording functions will have to do self-reporting.

Notice that this same service may provide for session size tracking, or that sessions service will have to be of this same operational principle.

#### EventEmitter

We may do main/worker split now with EventEmitter.
When moving to cluster, we'll only need to have message passing in cluster instead of our custom events.
By the way, meassages are events, too.