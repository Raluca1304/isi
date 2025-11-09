import { Injectable } from '@angular/core';
import { AngularFireDatabase, AngularFireList } from '@angular/fire/compat/database';

export interface MapPoint {
  id?: string;
  lat: number;
  lon: number;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class FirebaseService {
  private pointsRef: AngularFireList<MapPoint>;
  private userRef: any;

  constructor(private db: AngularFireDatabase) {
    this.pointsRef = this.db.list('points');       // colecția de puncte
    this.userRef = this.db.object('userPosition'); // poziția utilizatorului
  }

  // 🔹 Adaugă un punct nou în baza de date
  addPoint(lat: number, lon: number) {
    const point: MapPoint = { lat, lon, timestamp: Date.now() };
    return this.pointsRef.push(point);
  }

  // 🔹 Returnează toate punctele (cu actualizare în timp real)
  getPoints() {
    return this.pointsRef.valueChanges();
  }

  // 🔹 Actualizează poziția utilizatorului (max. o dată pe secundă)
  updateUserPosition(lat: number, lon: number) {
    this.userRef.update({ lat, lon, timestamp: Date.now() });
  }

  // 🔹 Returnează poziția utilizatorului (cu actualizare live)
  getUserPosition() {
    return this.userRef.valueChanges();
  }
}
